//! 文档内嵌预览：按源节点（画板/思维导图）读取预览图，并接收前端渲染结果。
//!
//! 预览图是内部对象：复用附件对象库（scope=node，逻辑目录 `__preview`），
//! 并通过 `node_attachment` 登记“源节点 → 预览对象”引用，回收交给既有维护任务。
//! 渲染只能在浏览器完成（Excalidraw 导出器 / 导图 SVG 光栅化），Rust 只负责存取。

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::TransactionBehavior;

use crate::domain::NodeType;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::PREVIEW_LOGICAL_PATH;
use crate::models::node_preview::{
    NodePreviewDto, NodePreviewRow, SaveNodePreviewInput, SaveNodePreviewResult,
};
use crate::repositories::node_attachment_repository;
use crate::repositories::node_preview_repository as repository;
use crate::repositories::node_repository;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::now_ms;

/// 预览图上限；只放缩略图，超过说明前端缩放没生效。
const MAX_PREVIEW_BYTES: i64 = 8 * 1024 * 1024;
/// 单边像素上限，防止异常尺寸。
const MAX_DIMENSION: i64 = 20_000;
/// 固定 PNG 输出，前端捕获到损坏数据时直接拒绝。
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// 按画板/思维导图 id 读取文档内嵌图片；不存在或对象缺失返回 None，由前端生成。
pub fn load(
    state: &AppState,
    node_id: &str,
    expected: NodeType,
) -> AppResult<Option<NodePreviewDto>> {
    let (node_updated_at, row) = with_session(state, |session| {
        let node = node_repository::find_by_id(&session.connection, node_id)?
            .ok_or_else(|| AppError::not_found("内嵌内容不存在"))?;
        let actual = NodeType::from_i64(node.node_type)?;
        if actual != expected {
            return Err(AppError::validation("内嵌内容类型不匹配"));
        }
        Ok((
            node.update_time,
            repository::find(&session.connection, node_id)?,
        ))
    })?;
    let Some(row) = row else {
        return Ok(None);
    };
    let context = AttachmentContext::from_state(state)?;
    let (attachment, bytes) =
        match attachment_service::read_image_object(&context, &row.object_id, MAX_PREVIEW_BYTES) {
            Ok(value) => value,
            Err(error) => {
                logging::debug(
                    "preview",
                    &format!(
                        "预览对象缺失 node={node_id} object={}: {error}",
                        row.object_id
                    ),
                );
                return Ok(None);
            }
        };
    Ok(Some(NodePreviewDto {
        node_id: node_id.to_string(),
        data_url: format!("data:{};base64,{}", attachment.mime, BASE64.encode(bytes)),
        width: row.width,
        height: row.height,
        source_updated_at: row.source_updated_at,
        stale: row.source_updated_at < node_updated_at,
    }))
}

/// 写入前端渲染好的预览；同版本或同字节不重复落对象。
pub fn save(state: &AppState, input: SaveNodePreviewInput) -> AppResult<SaveNodePreviewResult> {
    if input.width <= 0
        || input.height <= 0
        || input.width > MAX_DIMENSION
        || input.height > MAX_DIMENSION
    {
        return Err(AppError::validation("预览图尺寸无效"));
    }
    if input.source_updated_at < 0 {
        return Err(AppError::validation("预览版本无效"));
    }
    // 先按 base64 长度粗筛，避免为超大载荷先分配解码缓冲区；正式大小仍以解码字节为准。
    if input.data_base64.trim().len() as i64 > MAX_PREVIEW_BYTES.saturating_mul(4) / 3 + 8 {
        return Err(AppError::validation("预览图过大"));
    }
    let bytes = BASE64
        .decode(input.data_base64.trim().as_bytes())
        .map_err(|_| AppError::validation("预览图数据无效"))?;
    if bytes.is_empty() {
        return Err(AppError::validation("预览图数据为空"));
    }
    if bytes.len() as i64 > MAX_PREVIEW_BYTES {
        return Err(AppError::validation("预览图过大"));
    }
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(AppError::validation("预览图必须是 PNG"));
    }
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let now = now_ms();

    let existing = with_session(state, |session| {
        let node = node_repository::find_by_id(&session.connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("内嵌内容不存在"))?;
        require_preview_node(node.node_type)?;
        Ok(repository::find(&session.connection, &input.node_id)?)
    })?;

    // 同一源版本的重试：直接返回现状，不产生新对象。
    if let Some(row) = &existing
        && row.source_updated_at >= input.source_updated_at
        && row.width == input.width
        && row.height == input.height
    {
        return Ok(result_of(row));
    }

    let context = AttachmentContext::from_state(state)?;
    // 字节未变（例如只改了画布视口）：沿用对象，只刷新版本与尺寸。
    if let Some(row) = &existing
        && let Ok(attachment) = attachment_service::get(&context, &row.object_id)
        && attachment.content_hash == hash
    {
        let updated = NodePreviewRow {
            node_id: input.node_id.clone(),
            object_id: row.object_id.clone(),
            width: input.width,
            height: input.height,
            source_updated_at: input.source_updated_at,
            updated_at: now,
        };
        with_session(state, |session| {
            let transaction = session
                .connection
                .transaction_with_behavior(TransactionBehavior::Immediate)?;
            repository::upsert(&transaction, &updated)?;
            transaction.commit()?;
            Ok(())
        })?;
        return Ok(result_of(&updated));
    }

    let attachment = attachment_service::upload_bytes(
        &context,
        format!("preview-{}.png", input.node_id),
        PREVIEW_LOGICAL_PATH.to_string(),
        Some("image/png".to_string()),
        bytes,
    )?;

    let saved = with_session(state, |session| {
        let connection = &mut session.connection;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let node = node_repository::find_by_id(&transaction, &input.node_id)?
            .ok_or_else(|| AppError::not_found("内嵌内容不存在"))?;
        require_preview_node(node.node_type)?;
        let latest = repository::find(&transaction, &input.node_id)?;
        // 并发渲染时以更新的源版本为准；本次对象失引用后由维护任务回收。
        if let Some(row) = &latest
            && row.object_id != attachment.id
            && row.source_updated_at >= input.source_updated_at
        {
            transaction.commit()?;
            return Ok(row.clone());
        }
        if let Some(row) = &latest
            && row.object_id != attachment.id
        {
            node_attachment_repository::delete_reference(
                &transaction,
                &input.node_id,
                &row.object_id,
                now,
            )?;
        }
        node_attachment_repository::insert_reference(
            &transaction,
            &input.node_id,
            &attachment.id,
            now,
        )?;
        let row = NodePreviewRow {
            node_id: input.node_id.clone(),
            object_id: attachment.id.clone(),
            width: input.width,
            height: input.height,
            source_updated_at: input.source_updated_at,
            updated_at: now,
        };
        repository::upsert(&transaction, &row)?;
        transaction.commit()?;
        Ok(row)
    })?;

    logging::debug(
        "preview",
        &format!(
            "内嵌预览已写入 node={} object={} size={}x{} bytes={}",
            saved.node_id, saved.object_id, saved.width, saved.height, attachment.size
        ),
    );
    Ok(result_of(&saved))
}

fn result_of(row: &NodePreviewRow) -> SaveNodePreviewResult {
    SaveNodePreviewResult {
        node_id: row.node_id.clone(),
        object_id: row.object_id.clone(),
        width: row.width,
        height: row.height,
        source_updated_at: row.source_updated_at,
        updated_at: row.updated_at,
    }
}

fn require_preview_node(node_type: i64) -> AppResult<()> {
    match NodeType::from_i64(node_type)? {
        NodeType::Board | NodeType::Mindmap => Ok(()),
        _ => Err(AppError::validation("此内容不能作为内嵌预览")),
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
