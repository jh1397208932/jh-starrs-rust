//! 知识库 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{CreateKbInput, DeleteKbResult, KnowledgeBaseDto, UpdateKbInput};
use crate::services::knowledge_base_service;
use crate::state::AppState;

/// 列出当前工作区知识库。
#[tauri::command(async)]
pub fn kb_list(state: State<'_, AppState>) -> AppResult<Vec<KnowledgeBaseDto>> {
    knowledge_base_service::list(state.inner())
}

/// 查询单个知识库。
#[tauri::command(async)]
pub fn kb_get(state: State<'_, AppState>, id: String) -> AppResult<KnowledgeBaseDto> {
    knowledge_base_service::get(state.inner(), &id)
}

/// 新建知识库。
#[tauri::command(async)]
pub fn kb_create(state: State<'_, AppState>, input: CreateKbInput) -> AppResult<KnowledgeBaseDto> {
    knowledge_base_service::create(state.inner(), input)
}

/// 修改知识库名称/描述。
#[tauri::command(async)]
pub fn kb_update(state: State<'_, AppState>, input: UpdateKbInput) -> AppResult<KnowledgeBaseDto> {
    knowledge_base_service::update(state.inner(), input)
}

/// 删除知识库（级联节点）。
#[tauri::command(async)]
pub fn kb_delete(state: State<'_, AppState>, id: String) -> AppResult<DeleteKbResult> {
    knowledge_base_service::delete(state.inner(), &id)
}
