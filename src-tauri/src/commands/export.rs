//! 导出 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{
    ExportDocumentInput, ExportFileDto, ExportKnowledgeBaseInput, ExportResult,
    ExportWriteFileInput,
};
use crate::services::export_service;
use crate::state::AppState;

/// 导出单个文档为 Markdown / HTML / Word / PDF。
#[tauri::command(async)]
pub fn export_document(
    state: State<'_, AppState>,
    input: ExportDocumentInput,
) -> AppResult<ExportResult> {
    export_service::export_document(state.inner(), input)
}

/// 按文件树导出整个知识库（含附件与 manifest）。
#[tauri::command(async)]
pub fn export_knowledge_base(
    state: State<'_, AppState>,
    input: ExportKnowledgeBaseInput,
) -> AppResult<ExportResult> {
    export_service::export_knowledge_base(state.inner(), input)
}

/// 写入桌面端渲染的导出文件（画板 PNG/SVG/Excalidraw）。
#[tauri::command(async)]
pub fn export_write_file(input: ExportWriteFileInput) -> AppResult<ExportFileDto> {
    export_service::write_export_file(input)
}
