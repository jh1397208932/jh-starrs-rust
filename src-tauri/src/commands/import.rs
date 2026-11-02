//! 导入 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::exchange::ImportScanResult;
use crate::models::{ImportDocumentsInput, ImportResult};
use crate::services::import_service;
use crate::state::AppState;

/// 导入 Markdown / Word / PDF 文件或目录，支持目标子文件夹与目录层级。
#[tauri::command(async)]
pub fn import_documents(
    state: State<'_, AppState>,
    input: ImportDocumentsInput,
) -> AppResult<ImportResult> {
    import_service::import_documents(state.inner(), input)
}

/// 混合导入预扫描：列出会转成文档/画板/导图/附件的数量与将跳过的文件。
#[tauri::command(async)]
pub fn import_scan_folder(folder_path: String) -> AppResult<ImportScanResult> {
    import_service::scan_folder(&folder_path)
}
