//! 模板库 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::template::{
    CreateFromTemplateInput, CreateFromTemplateResult, SaveTemplateInput, TemplateSummary,
};
use crate::services::template_service;
use crate::state::AppState;

/// 列出当前工作区模板。
#[tauri::command(async)]
pub fn template_list(state: State<'_, AppState>) -> AppResult<Vec<TemplateSummary>> {
    template_service::list(state.inner())
}

/// 保存当前文档/画板为模板。
#[tauri::command(async)]
pub fn template_save(
    state: State<'_, AppState>,
    input: SaveTemplateInput,
) -> AppResult<TemplateSummary> {
    template_service::save(state.inner(), input)
}

/// 从模板创建节点。
#[tauri::command(async)]
pub fn template_create_node(
    state: State<'_, AppState>,
    input: CreateFromTemplateInput,
) -> AppResult<CreateFromTemplateResult> {
    template_service::create_node(state.inner(), input)
}

/// 删除模板。
#[tauri::command(async)]
pub fn template_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    template_service::delete(state.inner(), &id)
}
