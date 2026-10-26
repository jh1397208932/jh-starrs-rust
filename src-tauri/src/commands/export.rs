//! 导出 IPC 适配层；所有写路径必须来自 Rust 系统面板签发的授权令牌。

use serde::Deserialize;
use tauri::State;

use crate::commands::dialog;
use crate::errors::AppResult;
use crate::models::{
    ExportDocumentInput, ExportFileDto, ExportFormat, ExportKnowledgeBaseInput, ExportResult,
    ExportWriteFileInput,
};
use crate::services::export_service;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentRequest {
    pub node_id: String,
    pub format: ExportFormat,
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportKnowledgeBaseRequest {
    pub knowledge_base_id: String,
    pub format: ExportFormat,
    pub token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportWriteFileRequest {
    pub token: String,
    pub path: String,
    pub data_base64: String,
    pub overwrite: bool,
}

/// 导出单个文档为 Markdown / HTML / Word / PDF。
#[tauri::command(async)]
pub fn export_document(
    state: State<'_, AppState>,
    input: ExportDocumentRequest,
) -> AppResult<ExportResult> {
    let dest_path = dialog::resolve_file(&input.token)?;
    export_service::export_document(
        state.inner(),
        ExportDocumentInput {
            node_id: input.node_id,
            format: input.format,
            dest_path: dest_path.to_string_lossy().into_owned(),
        },
    )
}

/// 按文件树导出整个知识库（含附件与 manifest）。
#[tauri::command(async)]
pub fn export_knowledge_base(
    state: State<'_, AppState>,
    input: ExportKnowledgeBaseRequest,
) -> AppResult<ExportResult> {
    let dest_dir = dialog::resolve_directory(&input.token)?;
    export_service::export_knowledge_base(
        state.inner(),
        ExportKnowledgeBaseInput {
            knowledge_base_id: input.knowledge_base_id,
            format: input.format,
            dest_dir: dest_dir.to_string_lossy().into_owned(),
        },
    )
}

/// 写入桌面端渲染的导出文件（画板 PNG/SVG/Excalidraw）。
#[tauri::command(async)]
pub fn export_write_file(input: ExportWriteFileRequest) -> AppResult<ExportFileDto> {
    let path = dialog::resolve_write(&input.token, &input.path)?;
    export_service::write_export_file(ExportWriteFileInput {
        path: path.to_string_lossy().into_owned(),
        data_base64: input.data_base64,
        overwrite: input.overwrite,
    })
}
