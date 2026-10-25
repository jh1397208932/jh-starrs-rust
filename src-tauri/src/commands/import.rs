//! 导入 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{ImportDocumentsInput, ImportResult};
use crate::services::import_service;
use crate::state::AppState;

/// 导入 Markdown / Word 文件或目录，支持目标子文件夹与目录层级。
#[tauri::command(async)]
pub fn import_documents(
    state: State<'_, AppState>,
    input: ImportDocumentsInput,
) -> AppResult<ImportResult> {
    import_service::import_documents(state.inner(), input)
}
