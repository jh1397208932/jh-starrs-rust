//! 思维导图 IPC 适配层。

use serde::Deserialize;
use tauri::State;

use crate::commands::dialog;
use crate::errors::AppResult;
use crate::models::exchange::{ExportResult, ImportResult};
use crate::models::mindmap::{
    MindmapLoadResult, MindmapSaveInput, MindmapSaveResult, MindmapSaveViewportInput,
    MindmapViewportDto,
};
use crate::services::mindmap_format::MindmapFormat;
use crate::services::{mindmap_import_service, mindmap_service};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapExportRequest {
    pub node_id: String,
    pub format: MindmapFormat,
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMindmapsRequest {
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    pub paths: Vec<String>,
}

/// 加载思维导图。
#[tauri::command(async)]
pub fn mindmap_load(state: State<'_, AppState>, node_id: String) -> AppResult<MindmapLoadResult> {
    mindmap_service::load(state.inner(), &node_id)
}

/// 保存思维导图场景。
#[tauri::command(async)]
pub fn mindmap_save(
    state: State<'_, AppState>,
    input: MindmapSaveInput,
) -> AppResult<MindmapSaveResult> {
    mindmap_service::save(state.inner(), input)
}

/// 保存思维导图视口。
#[tauri::command(async)]
pub fn mindmap_save_viewport(
    state: State<'_, AppState>,
    input: MindmapSaveViewportInput,
) -> AppResult<MindmapViewportDto> {
    mindmap_service::save_viewport(state.inner(), input)
}

/// 导出思维导图到 Rust 面板签发的目标路径。
#[tauri::command(async)]
pub fn mindmap_export(
    state: State<'_, AppState>,
    input: MindmapExportRequest,
) -> AppResult<ExportResult> {
    let dest_path = dialog::resolve_file(&input.token)?;
    mindmap_service::export(
        state.inner(),
        &input.node_id,
        input.format,
        &dest_path.to_string_lossy(),
    )
}

/// 批量导入思维导图文件。
#[tauri::command(async)]
pub fn import_mindmaps(
    state: State<'_, AppState>,
    input: ImportMindmapsRequest,
) -> AppResult<ImportResult> {
    mindmap_import_service::import(
        state.inner(),
        &input.knowledge_base_id,
        input.parent_id.as_deref(),
        &input.paths,
    )
}
