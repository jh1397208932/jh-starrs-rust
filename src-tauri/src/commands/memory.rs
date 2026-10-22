//! 统一记忆配置 IPC 适配层。

use std::collections::BTreeMap;

use tauri::State;

use crate::errors::AppResult;
use crate::services::memory_service;
use crate::state::AppState;

/// 读取全部记忆配置。
#[tauri::command(async)]
pub fn memory_load(state: State<'_, AppState>) -> AppResult<BTreeMap<String, String>> {
    memory_service::load(state.inner())
}

/// 批量保存记忆配置。
#[tauri::command(async)]
pub fn memory_save(state: State<'_, AppState>, entries: BTreeMap<String, String>) -> AppResult<()> {
    memory_service::save(state.inner(), &entries)
}
