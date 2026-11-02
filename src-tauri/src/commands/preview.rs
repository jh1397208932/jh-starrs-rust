//! 文档内嵌预览 IPC 适配层。

use tauri::State;

use crate::domain::NodeType;
use crate::errors::AppResult;
use crate::models::node_preview::{NodePreviewDto, SaveNodePreviewInput, SaveNodePreviewResult};
use crate::services::node_preview_service;
use crate::state::AppState;

/// 按画板 id 读取文档内嵌图片；没有预览返回 null。
#[tauri::command(async)]
pub fn board_image(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<Option<NodePreviewDto>> {
    node_preview_service::load(state.inner(), &node_id, NodeType::Board)
}

/// 按思维导图 id 读取文档内嵌图片；没有预览返回 null。
#[tauri::command(async)]
pub fn mindmap_image(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<Option<NodePreviewDto>> {
    node_preview_service::load(state.inner(), &node_id, NodeType::Mindmap)
}

/// 写入前端渲染好的预览图。
#[tauri::command(async)]
pub fn node_preview_save(
    state: State<'_, AppState>,
    input: SaveNodePreviewInput,
) -> AppResult<SaveNodePreviewResult> {
    node_preview_service::save(state.inner(), input)
}
