//! 画板用例：场景/视口持久化与图片对象回填。
//!
//! 设计约束（2026-10-24）：画板不建文件映射表；图片元素 `fileId` 直接使用
//! 全局对象 id，非图片附件把 objectId 写在图元 customData 里。保存只写场景，
//! 对象在上传/插入时已经进入现有附件对象存储。

use std::collections::BTreeSet;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::TransactionBehavior;
use serde_json::{Map, Value, json};

use crate::domain::NodeType;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::board::{
    BoardFileDto, BoardLoadResult, BoardSaveInput, BoardSaveResult, BoardSaveViewportInput,
    BoardViewportDto,
};
use crate::repositories::board_repository as repository;
use crate::services::attachment_reference_service;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::now_ms;

/// 画板场景 JSON 上限，防止异常 IPC 把库撑爆。
const MAX_ELEMENTS_BYTES: usize = 32 * 1024 * 1024;
/// 画板单张图片内嵌上限；与 attachment MAX_BYTE_UPLOAD 对齐。
const MAX_IMAGE_BYTES: i64 = 64 * 1024 * 1024;

/// 加载画板：先读场景与视口，再在会话锁外按 object_id 回填图片。
pub fn load(state: &AppState, node_id: &str) -> AppResult<BoardLoadResult> {
    let loaded = with_session(state, |session| load_scene(session, node_id))?;

    let mut files = Vec::new();
    let mut missing: BTreeSet<String> = BTreeSet::new();
    if !loaded.image_ids.is_empty() || !loaded.card_ids.is_empty() {
        let context = AttachmentContext::from_state(state)?;
        for object_id in &loaded.image_ids {
            match attachment_service::read_image_object(&context, object_id, MAX_IMAGE_BYTES) {
                Ok((attachment, bytes)) => files.push(BoardFileDto {
                    id: object_id.clone(),
                    mime_type: attachment.mime.clone(),
                    data_url: format!("data:{};base64,{}", attachment.mime, BASE64.encode(bytes)),
                    created: attachment.created_at,
                }),
                Err(error) => {
                    logging::debug(
                        "board",
                        &format!("画板图片对象缺失 node={node_id} object={object_id}: {error}"),
                    );
                    missing.insert(object_id.clone());
                }
            }
        }
        for object_id in &loaded.card_ids {
            if loaded.image_ids.contains(object_id) {
                continue;
            }
            if let Err(error) = attachment_service::get(&context, object_id) {
                logging::debug(
                    "board",
                    &format!("画板附件对象缺失 node={node_id} object={object_id}: {error}"),
                );
                missing.insert(object_id.clone());
            }
        }
    }

    Ok(BoardLoadResult {
        node_id: node_id.to_string(),
        elements: loaded.elements,
        app_state: loaded.app_state,
        viewport: loaded.viewport,
        files,
        version: loaded.version,
        updated_at: loaded.updated_at,
        missing_object_ids: missing.into_iter().collect(),
    })
}

/// 画板导出用的场景快照；只读 JSON，不读取图片字节。
#[derive(Debug, Clone)]
pub struct BoardSnapshot {
    pub elements: Value,
    pub app_state: Value,
}

/// 读取画板场景原始 JSON，供整库导出写 `.excalidraw`。
pub fn snapshot(state: &AppState, node_id: &str) -> AppResult<BoardSnapshot> {
    with_session(state, |session| {
        let loaded = load_scene(session, node_id)?;
        Ok(BoardSnapshot {
            elements: loaded.elements,
            app_state: loaded.app_state,
        })
    })
}

/// 保存画板场景；对象已在粘贴/插入时落库，本函数只写场景与版本。
pub fn save(state: &AppState, input: BoardSaveInput) -> AppResult<BoardSaveResult> {
    if input.base_version < 0 {
        return Err(AppError::validation("画板状态无效"));
    }
    with_session(state, |session| {
        let connection = &mut session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("画板不存在"))?;
        require_board(node.node_type)?;

        let (elements, element_count) = normalize_elements(&input.elements)?;
        let elements_value: Value = serde_json::from_str(&elements).map_err(|error| {
            logging::error("board", &format!("画板元素序列化后无法解析: {error}"));
            AppError::Internal
        })?;
        let app_state = normalize_app_state(&input.app_state)?;
        let updated_at = now_ms();
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = repository::find_scene(&transaction, &input.node_id)?;
        let current_version = existing.as_ref().map_or(0, |row| row.scene_version);
        if current_version != input.base_version {
            return Err(AppError::conflict("画板已在别处更新，请重新加载"));
        }
        let next_version = current_version + 1;
        match existing {
            Some(_) => repository::update_scene(
                &transaction,
                &input.node_id,
                &elements,
                &app_state,
                next_version,
                element_count,
                updated_at,
            )?,
            None => repository::insert_scene(
                &transaction,
                &input.node_id,
                &elements,
                &app_state,
                next_version,
                element_count,
                updated_at,
            )?,
        }
        repository::touch_node(&transaction, &input.node_id, updated_at)?;
        attachment_reference_service::sync_board_refs(
            &transaction,
            &input.node_id,
            &elements_value,
            updated_at,
        )?;
        transaction.commit()?;
        logging::info(
            "board",
            &format!(
                "画板已保存 node={} version={} elements={} bytes={}",
                input.node_id,
                next_version,
                element_count,
                elements.len()
            ),
        );
        Ok(BoardSaveResult {
            version: next_version,
            updated_at,
            element_count,
        })
    })
}

/// 保存视口；不递增场景版本，也不更新节点更新时间。
pub fn save_viewport(
    state: &AppState,
    input: BoardSaveViewportInput,
) -> AppResult<BoardViewportDto> {
    if !input.scroll_x.is_finite() || !input.scroll_y.is_finite() {
        return Err(AppError::validation("画板状态无效"));
    }
    if !input.zoom.is_finite() || input.zoom <= 0.0 || input.zoom > 30.0 {
        return Err(AppError::validation("画板状态无效"));
    }
    with_session(state, |session| {
        let connection = &session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("画板不存在"))?;
        require_board(node.node_type)?;
        repository::upsert_viewport(
            connection,
            &input.node_id,
            input.scroll_x,
            input.scroll_y,
            input.zoom,
            now_ms(),
        )?;
        Ok(BoardViewportDto {
            scroll_x: input.scroll_x,
            scroll_y: input.scroll_y,
            zoom: input.zoom,
        })
    })
}

struct LoadedScene {
    elements: Value,
    app_state: Value,
    viewport: BoardViewportDto,
    version: i64,
    updated_at: i64,
    image_ids: BTreeSet<String>,
    card_ids: BTreeSet<String>,
}

/// 读取场景/视口并收集对象 id；不在这里读字节，避免持有会话锁做 IO。
fn load_scene(session: &WorkspaceSession, node_id: &str) -> AppResult<LoadedScene> {
    let connection = &session.connection;
    let node = repository::find_node(connection, node_id)?
        .ok_or_else(|| AppError::not_found("画板不存在"))?;
    require_board(node.node_type)?;
    let scene = repository::find_scene(connection, node_id)?;
    let (elements, app_state, version, updated_at) = match scene {
        Some(row) => {
            let elements: Value = serde_json::from_str(&row.elements_json).map_err(|error| {
                logging::error(
                    "board",
                    &format!("画板图元 JSON 损坏 node={node_id}: {error}"),
                );
                AppError::Internal
            })?;
            let app_state: Value =
                serde_json::from_str(&row.app_state_json).unwrap_or_else(|_| json!({}));
            (elements, app_state, row.scene_version, row.updated_at)
        }
        None => (json!([]), json!({}), 0, node.update_time),
    };
    let viewport = repository::find_viewport(connection, node_id)?.map_or(
        BoardViewportDto {
            scroll_x: 0.0,
            scroll_y: 0.0,
            zoom: 1.0,
        },
        |row| BoardViewportDto {
            scroll_x: row.scroll_x,
            scroll_y: row.scroll_y,
            zoom: row.zoom,
        },
    );
    let (image_ids, card_ids) = collect_object_ids(&elements);
    Ok(LoadedScene {
        elements,
        app_state,
        viewport,
        version,
        updated_at,
        image_ids,
        card_ids,
    })
}

/// 从图元中收集图片 object_id 与文件卡片 objectId；没有映射表。
pub(crate) fn collect_object_ids(elements: &Value) -> (BTreeSet<String>, BTreeSet<String>) {
    let mut images = BTreeSet::new();
    let mut cards = BTreeSet::new();
    if let Some(array) = elements.as_array() {
        for element in array {
            if element.get("type").and_then(Value::as_str) == Some("image")
                && let Some(file_id) = element.get("fileId").and_then(Value::as_str)
                && !file_id.is_empty()
            {
                images.insert(file_id.to_string());
            }
            if let Some(custom) = element.get("customData").and_then(Value::as_object)
                && custom
                    .get("boardFileCard")
                    .and_then(Value::as_bool)
                    .is_some_and(|value| value)
                && let Some(object_id) = custom.get("objectId").and_then(Value::as_str)
                && !object_id.is_empty()
            {
                cards.insert(object_id.to_string());
            }
        }
    }
    (images, cards)
}

/// 过滤已删除图元并序列化；元素结构由 Excalidraw 前端负责。
fn normalize_elements(value: &Value) -> AppResult<(String, i64)> {
    let array = value
        .as_array()
        .ok_or_else(|| AppError::validation("画板内容无效"))?;
    let kept: Vec<&Value> = array
        .iter()
        .filter(|element| {
            !element
                .get("isDeleted")
                .and_then(Value::as_bool)
                .is_some_and(|value| value)
        })
        .collect();
    let serialized = serde_json::to_string(&kept).map_err(|error| {
        logging::error("board", &format!("画板图元序列化失败: {error}"));
        AppError::Internal
    })?;
    if serialized.len() > MAX_ELEMENTS_BYTES {
        return Err(AppError::validation("画板内容过大"));
    }
    Ok((serialized, kept.len() as i64))
}

/// 只持久化 Excalidraw 官方导出白名单中的画布设置。
fn normalize_app_state(value: &Value) -> AppResult<String> {
    if value.is_null() {
        return Ok("{}".to_string());
    }
    let object = value
        .as_object()
        .ok_or_else(|| AppError::validation("画板设置无效"))?;
    let mut output = Map::new();
    if let Some(color) = object.get("viewBackgroundColor") {
        let color = color
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 64)
            .ok_or_else(|| AppError::validation("画板设置无效"))?;
        output.insert(
            "viewBackgroundColor".to_string(),
            Value::String(color.to_string()),
        );
    }
    if let Some(grid) = object.get("gridModeEnabled") {
        let grid = grid
            .as_bool()
            .ok_or_else(|| AppError::validation("画板设置无效"))?;
        output.insert("gridModeEnabled".to_string(), Value::Bool(grid));
    }
    if let Some(size) = object.get("gridSize") {
        if !size.is_null() && !size.is_number() {
            return Err(AppError::validation("画板设置无效"));
        }
        output.insert("gridSize".to_string(), size.clone());
    }
    if let Some(step) = object.get("gridStep") {
        if !step.is_number() {
            return Err(AppError::validation("画板设置无效"));
        }
        output.insert("gridStep".to_string(), step.clone());
    }
    serde_json::to_string(&output).map_err(|error| {
        logging::error("board", &format!("画板设置序列化失败: {error}"));
        AppError::Internal
    })
}

fn require_board(node_type: i64) -> AppResult<()> {
    match NodeType::from_i64(node_type)? {
        NodeType::Board | NodeType::Flow => Ok(()),
        _ => Err(AppError::validation("此内容不是画板或流程图")),
    }
}

fn with_session<T>(
    state: &AppState,
    action: impl FnOnce(&mut WorkspaceSession) -> AppResult<T>,
) -> AppResult<T> {
    let mut guard = state.workspace()?;
    let session = guard.as_mut().ok_or(AppError::NoActiveWorkspace)?;
    action(session)
}
