//! 组件库 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::library::{
    DeleteLibraryResult, ImportLibraryInput, LibraryDto, LibraryItemDto, SetLibraryEnabledInput,
};
use crate::services::library_service;
use crate::state::AppState;

/// 列出组件库（含内置预设 seed）。
#[tauri::command(async)]
pub fn library_list(state: State<'_, AppState>) -> AppResult<Vec<LibraryDto>> {
    library_service::list(state.inner())
}

/// 读取启用库的组件，供画板 Library 使用。
#[tauri::command(async)]
pub fn library_items(state: State<'_, AppState>) -> AppResult<Vec<LibraryItemDto>> {
    library_service::enabled_items(state.inner())
}

/// 导入 `.excalidrawlib`。
#[tauri::command(async)]
pub fn library_import(
    state: State<'_, AppState>,
    input: ImportLibraryInput,
) -> AppResult<LibraryDto> {
    library_service::import(state.inner(), input)
}

/// 启用/禁用组件库。
#[tauri::command(async)]
pub fn library_set_enabled(
    state: State<'_, AppState>,
    input: SetLibraryEnabledInput,
) -> AppResult<LibraryDto> {
    library_service::set_enabled(state.inner(), input)
}

/// 删除导入库；预设库只能停用。
#[tauri::command(async)]
pub fn library_delete(state: State<'_, AppState>, id: String) -> AppResult<DeleteLibraryResult> {
    library_service::delete(state.inner(), &id)
}
