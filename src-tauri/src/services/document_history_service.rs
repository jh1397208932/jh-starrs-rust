//! 文档历史：列出快照与恢复为当前正文。

use crate::errors::{AppError, AppResult};
use crate::models::history::{DocHistorySummary, RestoreDocHistoryInput};
use crate::models::{DocSaveResult, SaveDocumentInput};
use crate::repositories::document_history_repository as repository;
use crate::state::AppState;

/// 列出某文档的历史快照。
pub fn list(state: &AppState, node_id: &str) -> AppResult<Vec<DocHistorySummary>> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    Ok(repository::list(&session.connection, node_id, 50)?)
}

/// 把历史快照恢复为当前正文；恢复本身也会走文档保存与版本校验。
pub fn restore(state: &AppState, input: RestoreDocHistoryInput) -> AppResult<DocSaveResult> {
    let content = {
        let guard = state.workspace()?;
        let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
        repository::find_content(&session.connection, &input.node_id, &input.history_id)?
            .ok_or_else(|| AppError::not_found("历史版本不存在"))?
    };
    let version = crate::services::document_service::load(state, &input.node_id)?.version;
    let document: serde_json::Value =
        serde_json::from_str(&content).map_err(|_| AppError::validation("历史版本内容损坏"))?;
    crate::services::document_service::save(
        state,
        SaveDocumentInput {
            node_id: input.node_id,
            document,
            base_version: version,
        },
    )
}
