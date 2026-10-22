//! 文档块存储 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{DocLoadResult, DocSaveResult, SaveDocumentInput};
use crate::services::document_service;
use crate::state::AppState;

/// 加载文档正文（`node.content` 缓存）与块树顺序。
#[tauri::command(async)]
pub fn doc_load(state: State<'_, AppState>, node_id: String) -> AppResult<DocLoadResult> {
    document_service::load(state.inner(), &node_id)
}

/// 保存文档并返回块差量。
#[tauri::command(async)]
pub fn doc_save(state: State<'_, AppState>, input: SaveDocumentInput) -> AppResult<DocSaveResult> {
    document_service::save(state.inner(), input)
}
