//! 统一记忆配置 IPC 适配层。

use std::collections::BTreeMap;

use tauri::{AppHandle, State};

use crate::errors::{AppError, AppResult};
use crate::services::memory_service;
use crate::state::AppState;

/// 读取全部记忆配置。
#[tauri::command(async)]
pub fn memory_load(state: State<'_, AppState>) -> AppResult<BTreeMap<String, String>> {
    memory_service::load(state.inner())
}

/// 批量保存记忆配置。
#[tauri::command(async)]
pub fn memory_save(
    app: AppHandle,
    state: State<'_, AppState>,
    entries: BTreeMap<String, String>,
) -> AppResult<()> {
    memory_service::save(state.inner(), &entries)?;
    if let Some(locale) = entries.get(crate::models::SETTING_LOCALE) {
        // 仅 macOS 有原生菜单；其他平台 build 返回 None，无需重挂。
        if let Some(menu) = crate::menu::build(&app, locale).map_err(|_| AppError::Internal)? {
            app.set_menu(menu).map_err(|_| AppError::Internal)?;
        }
    }
    Ok(())
}
