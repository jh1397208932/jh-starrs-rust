//! 文件树节点 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{CreateNodeInput, DeleteNodeResult, MoveNodeInput, NodeDto, UpdateNodeInput};
use crate::services::node_service;
use crate::state::AppState;

/// 读取某知识库的完整树（平表）。
#[tauri::command(async)]
pub fn node_list(state: State<'_, AppState>, knowledge_base_id: String) -> AppResult<Vec<NodeDto>> {
    node_service::list(state.inner(), &knowledge_base_id)
}

/// 新建节点。
#[tauri::command(async)]
pub fn node_create(state: State<'_, AppState>, input: CreateNodeInput) -> AppResult<NodeDto> {
    node_service::create(state.inner(), input)
}

/// 修改节点标题/收藏状态。
#[tauri::command(async)]
pub fn node_update(state: State<'_, AppState>, input: UpdateNodeInput) -> AppResult<NodeDto> {
    node_service::update(state.inner(), input)
}

/// 递归删除节点。
#[tauri::command(async)]
pub fn node_delete(state: State<'_, AppState>, id: String) -> AppResult<DeleteNodeResult> {
    node_service::delete(state.inner(), &id)
}

/// 拖动移动节点（成为子级或同级排序）。
#[tauri::command(async)]
pub fn node_move(state: State<'_, AppState>, input: MoveNodeInput) -> AppResult<Vec<NodeDto>> {
    node_service::move_node(state.inner(), input)
}
