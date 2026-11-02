//! 思维导图用例：场景加载、乐观并发保存、视口、搜索索引与图片对象回填。
//!
//! 场景不保存坐标；布局由前端按 structure 实时计算。图片字节继续由全局附件
//! 对象库管理，场景只保存 object_id，删除导图时通过引用服务释放对象。

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::TransactionBehavior;

use crate::domain::NodeType;
use crate::domain::mindmap::{collect_image_object_ids, search_body, validate_content};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::exchange::{ExportFileDto, ExportResult};
use crate::models::mindmap::{
    MindmapContent, MindmapImageDto, MindmapLoadResult, MindmapSaveInput, MindmapSaveResult,
    MindmapSaveViewportInput, MindmapViewportDto, default_content,
};
use crate::repositories::mindmap_repository as repository;
use crate::repositories::search_repository;
use crate::services::attachment_reference_service;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::mindmap_format::{self, MindmapFormat};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::now_ms;

/// 场景 JSON 上限；5,000 个主题的典型数据远小于此值。
const MAX_CONTENT_BYTES: usize = 8 * 1024 * 1024;
/// 单张图片回填上限，与画板保持一致。
const MAX_IMAGE_BYTES: i64 = 64 * 1024 * 1024;

/// 加载思维导图；未保存过返回默认内容。
pub fn load(state: &AppState, node_id: &str) -> AppResult<MindmapLoadResult> {
    let loaded = with_session(state, |session| load_scene(session, node_id))?;
    let mut images = Vec::new();
    let mut missing = BTreeSet::new();
    if !loaded.content.is_default {
        let context = AttachmentContext::from_state(state)?;
        // 整份导图共用一个只读连接：图片多时避免逐张重开库。
        let connection = context.connection()?;
        for object_id in &loaded.object_ids {
            match attachment_service::read_image_object_with(
                &connection,
                &context.storage_root,
                object_id,
                MAX_IMAGE_BYTES,
            ) {
                Ok((attachment, bytes)) => {
                    // 直接编码进带前缀的字符串，避免 base64 结果再复制一次。
                    let mut data_url = String::with_capacity(
                        attachment.mime.len() + bytes.len().div_ceil(3) * 4 + 16,
                    );
                    data_url.push_str("data:");
                    data_url.push_str(&attachment.mime);
                    data_url.push_str(";base64,");
                    BASE64.encode_string(&bytes, &mut data_url);
                    images.push(MindmapImageDto {
                        id: object_id.clone(),
                        mime_type: attachment.mime.clone(),
                        data_url,
                        created: attachment.created_at,
                    });
                }
                Err(error) => {
                    logging::debug(
                        "mindmap",
                        &format!("导图图片对象缺失 node={node_id} object={object_id}: {error}"),
                    );
                    missing.insert(object_id.clone());
                }
            }
        }
    }

    Ok(MindmapLoadResult {
        node_id: node_id.to_string(),
        content: loaded.content.value,
        version: loaded.version,
        updated_at: loaded.updated_at,
        topic_count: loaded.topic_count,
        viewport: loaded.viewport,
        images,
        missing_object_ids: missing.into_iter().collect(),
    })
}

/// 保存场景；`baseVersion` 不匹配时拒绝覆盖。
pub fn save(state: &AppState, input: MindmapSaveInput) -> AppResult<MindmapSaveResult> {
    if input.base_version < 0 {
        return Err(AppError::validation("思维导图状态无效"));
    }
    let topic_count = validate_content(&input.content)?;
    let content_json = serde_json::to_string(&input.content).map_err(|error| {
        logging::error("mindmap", &format!("思维导图场景序列化失败: {error}"));
        AppError::Internal
    })?;
    if content_json.len() > MAX_CONTENT_BYTES {
        return Err(AppError::validation("思维导图内容过大"));
    }

    with_session(state, |session| {
        let connection = &mut session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("思维导图不存在"))?;
        require_mindmap(node.node_type)?;
        let updated_at = now_ms();
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = repository::find_scene(&transaction, &input.node_id)?;
        let current_version = existing.as_ref().map_or(0, |row| row.content_version);
        if current_version != input.base_version {
            return Err(AppError::conflict("思维导图已在别处更新，请重新加载"));
        }
        let next_version = current_version + 1;
        match existing {
            Some(_) => repository::update_scene(
                &transaction,
                &input.node_id,
                &content_json,
                next_version,
                topic_count as i64,
                updated_at,
            )?,
            None => repository::insert_scene(
                &transaction,
                &input.node_id,
                &content_json,
                topic_count as i64,
                updated_at,
            )?,
        }
        repository::touch_node(&transaction, &input.node_id, topic_count as i64, updated_at)?;
        search_repository::upsert(
            &transaction,
            &input.node_id,
            &node.title,
            &search_body(&input.content),
            &node.knowledge_base_id,
            NodeType::Mindmap.as_i64(),
            updated_at,
        )?;
        attachment_reference_service::sync_mindmap_refs(
            &transaction,
            &input.node_id,
            &input.content,
            updated_at,
        )?;
        transaction.commit()?;
        logging::info(
            "mindmap",
            &format!(
                "思维导图已保存 node={} version={} topics={} bytes={}",
                input.node_id,
                next_version,
                topic_count,
                content_json.len()
            ),
        );
        Ok(MindmapSaveResult {
            version: next_version,
            updated_at,
            topic_count: topic_count as i64,
        })
    })
}

/// 保存视口；不递增场景版本，也不改变节点编辑时间。
pub fn save_viewport(
    state: &AppState,
    input: MindmapSaveViewportInput,
) -> AppResult<MindmapViewportDto> {
    if !input.x.is_finite() || !input.y.is_finite() {
        return Err(AppError::validation("思维导图视口无效"));
    }
    if !input.zoom.is_finite() || input.zoom <= 0.0 || input.zoom > 30.0 {
        return Err(AppError::validation("思维导图缩放无效"));
    }
    with_session(state, |session| {
        let connection = &session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("思维导图不存在"))?;
        require_mindmap(node.node_type)?;
        repository::upsert_viewport(
            connection,
            &input.node_id,
            input.x,
            input.y,
            input.zoom,
            now_ms(),
        )?;
        Ok(MindmapViewportDto {
            x: input.x,
            y: input.y,
            zoom: input.zoom,
        })
    })
}

/// 导出与整库读取使用的场景快照。
pub struct MindmapSnapshot {
    pub title: String,
    pub content: MindmapContent,
}

/// 读取导图内容；未保存过时返回默认内容，便于导出空节点。
pub fn snapshot(state: &AppState, node_id: &str) -> AppResult<MindmapSnapshot> {
    with_session(state, |session| {
        let loaded = load_scene(session, node_id)?;
        let node = repository::find_node(&session.connection, node_id)?
            .ok_or_else(|| AppError::not_found("思维导图不存在"))?;
        Ok(MindmapSnapshot {
            title: node.title,
            content: loaded.content.value,
        })
    })
}

/// 导出思维导图到指定绝对路径。
pub fn export(
    state: &AppState,
    node_id: &str,
    format: MindmapFormat,
    dest_path: &str,
) -> AppResult<ExportResult> {
    let snapshot = snapshot(state, node_id)?;
    let mut destination = Path::new(dest_path).to_path_buf();
    if !destination.is_absolute() {
        return Err(AppError::validation("导出位置无效"));
    }
    let expected_extension = format.extension();
    let has_expected = destination
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected_extension));
    if !has_expected {
        destination.set_extension(expected_extension);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let context = AttachmentContext::from_state(state)?;
    // 导出时同一份导图的图片也复用一条连接。
    let connection = context.connection()?;
    let image_loader = |object_id: &str| -> AppResult<(Vec<u8>, String)> {
        let (attachment, bytes) = attachment_service::read_image_object_with(
            &connection,
            &context.storage_root,
            object_id,
            MAX_IMAGE_BYTES,
        )?;
        let extension = attachment
            .name
            .rsplit('.')
            .next()
            .unwrap_or("png")
            .to_ascii_lowercase();
        Ok((bytes, extension))
    };
    let exported = mindmap_format::export(
        &snapshot.content,
        &snapshot.title,
        format,
        Some(&image_loader),
    )?;
    fs::write(&destination, &exported.bytes)?;
    logging::info(
        "mindmap",
        &format!(
            "思维导图已导出 node={node_id} format={:?} bytes={}",
            format,
            exported.bytes.len()
        ),
    );
    Ok(ExportResult {
        root_path: crate::db::paths::path_to_string(&destination)?,
        files: vec![ExportFileDto {
            path: crate::db::paths::path_to_string(&destination)?,
            kind: "mindmap".to_string(),
        }],
        warnings: Vec::new(),
        ..Default::default()
    })
}

struct LoadedScene {
    content: LoadedContent,
    version: i64,
    updated_at: i64,
    topic_count: i64,
    viewport: Option<MindmapViewportDto>,
    object_ids: BTreeSet<String>,
}

struct LoadedContent {
    value: MindmapContent,
    is_default: bool,
}

fn load_scene(session: &mut WorkspaceSession, node_id: &str) -> AppResult<LoadedScene> {
    let connection = &session.connection;
    let node = repository::find_node(connection, node_id)?
        .ok_or_else(|| AppError::not_found("思维导图不存在"))?;
    require_mindmap(node.node_type)?;
    let scene = repository::find_scene(connection, node_id)?;
    let (content, version, topic_count, updated_at) = match scene {
        Some(row) => {
            let content: MindmapContent =
                serde_json::from_str(&row.content_json).map_err(|error| {
                    logging::error(
                        "mindmap",
                        &format!("思维导图场景 JSON 损坏 node={node_id}: {error}"),
                    );
                    AppError::Internal
                })?;
            validate_content(&content)?;
            (
                LoadedContent {
                    value: content,
                    is_default: false,
                },
                row.content_version,
                row.topic_count,
                row.updated_at,
            )
        }
        None => (
            LoadedContent {
                value: default_content(),
                is_default: true,
            },
            0,
            1,
            node.update_time,
        ),
    };
    let viewport = repository::find_viewport(connection, node_id)?.map(|row| MindmapViewportDto {
        x: row.x,
        y: row.y,
        zoom: row.zoom,
    });
    let object_ids = if content.is_default {
        BTreeSet::new()
    } else {
        collect_image_object_ids(&content.value)
    };
    Ok(LoadedScene {
        content,
        version,
        updated_at,
        topic_count,
        viewport,
        object_ids,
    })
}

fn require_mindmap(node_type: i64) -> AppResult<()> {
    match NodeType::from_i64(node_type)? {
        NodeType::Mindmap => Ok(()),
        _ => Err(AppError::validation("此内容不是思维导图")),
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
