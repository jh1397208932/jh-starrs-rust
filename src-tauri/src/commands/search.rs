//! 工作区检索 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::search::{NodeNetworkDto, SearchHit, SearchNodesInput};
use crate::services::search_service;
use crate::state::AppState;

/// 搜索当前知识库的节点标题/文档正文；空查询返回最近更新。
#[tauri::command(async)]
pub fn search_nodes(
    state: State<'_, AppState>,
    input: SearchNodesInput,
) -> AppResult<Vec<SearchHit>> {
    search_service::search(state.inner(), input)
}

/// 读取当前节点的反向链接与相关推荐。
#[tauri::command(async)]
pub fn node_network(state: State<'_, AppState>, node_id: String) -> AppResult<NodeNetworkDto> {
    search_service::network(state.inner(), &node_id)
}
