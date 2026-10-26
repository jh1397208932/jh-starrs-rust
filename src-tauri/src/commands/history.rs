//! 文档历史 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::DocSaveResult;
use crate::models::history::{DocHistorySummary, RestoreDocHistoryInput};
use crate::services::document_history_service;
use crate::state::AppState;

/// 列出文档历史快照。
#[tauri::command(async)]
pub fn doc_history_list(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<Vec<DocHistorySummary>> {
    document_history_service::list(state.inner(), &node_id)
}

/// 恢复历史快照到当前正文。
#[tauri::command(async)]
pub fn doc_history_restore(
    state: State<'_, AppState>,
    input: RestoreDocHistoryInput,
) -> AppResult<DocSaveResult> {
    document_history_service::restore(state.inner(), input)
}
