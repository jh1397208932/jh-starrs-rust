//! 记忆配置用例：统一批量读写，保留键由后端维护。

use std::collections::BTreeMap;

use crate::domain::{
    validate_memory_key, validate_memory_value, validate_theme_mode, validate_theme_name,
};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::{SETTING_CURRENT_WORKSPACE, SETTING_LOCALE, SETTING_MODE, SETTING_THEME};
use crate::repositories::settings_repository;
use crate::state::AppState;
use crate::utils::now_ms;

/// 读取全部记忆配置。
pub fn load(state: &AppState) -> AppResult<BTreeMap<String, String>> {
    let global = state.global()?;
    Ok(settings_repository::all(&global)?)
}

/// 批量写入记忆配置（upsert），单事务生效。
///
/// 保留键 `current_workspace_id` 拒绝前端写入，必须经统一切换入口更新。
pub fn save(state: &AppState, entries: &BTreeMap<String, String>) -> AppResult<()> {
    for (key, value) in entries {
        validate_memory_key(key)?;
        validate_memory_value(value)?;
        match key.as_str() {
            SETTING_CURRENT_WORKSPACE => {
                return Err(AppError::validation(
                    "当前工作区由切换操作统一维护，不能直接写入记忆配置",
                ));
            }
            SETTING_THEME => validate_theme_name(value)?,
            SETTING_MODE => validate_theme_mode(value)?,
            SETTING_LOCALE if value != "zh-CN" && value != "en-US" => {
                return Err(AppError::validation("界面语言不受支持"));
            }
            _ => {}
        }
    }
    if entries.is_empty() {
        return Ok(());
    }
    let global = state.global()?;
    settings_repository::set_many(&global, entries, now_ms())?;
    logging::debug("memory", &format!("保存记忆配置 {} 项", entries.len()));
    Ok(())
}
