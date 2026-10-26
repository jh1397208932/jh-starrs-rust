//! 文件树节点 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{
    CreateNodeInput, DeleteNodeResult, MoveNodeInput, NodeDto, RestoreNodeResult, TrashNodeDto,
    UpdateNodeInput,
};
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

/// 读取知识库回收站。
#[tauri::command(async)]
pub fn node_trash_list(
    state: State<'_, AppState>,
    knowledge_base_id: String,
) -> AppResult<Vec<TrashNodeDto>> {
    node_service::trash_list(state.inner(), &knowledge_base_id)
}

/// 从回收站恢复整棵子树。
#[tauri::command(async)]
pub fn node_restore(state: State<'_, AppState>, id: String) -> AppResult<RestoreNodeResult> {
    node_service::restore(state.inner(), &id)
}

/// 永久删除回收站节点。
#[tauri::command(async)]
pub fn node_trash_purge(state: State<'_, AppState>, id: String) -> AppResult<DeleteNodeResult> {
    node_service::trash_purge(state.inner(), &id)
}

/// 清空知识库回收站。
#[tauri::command(async)]
pub fn node_trash_empty(
    state: State<'_, AppState>,
    knowledge_base_id: String,
) -> AppResult<DeleteNodeResult> {
    node_service::trash_empty(state.inner(), &knowledge_base_id)
}

/// 拖动移动节点（成为子级或同级排序）。
#[tauri::command(async)]
pub fn node_move(state: State<'_, AppState>, input: MoveNodeInput) -> AppResult<Vec<NodeDto>> {
    node_service::move_node(state.inner(), input)
}
