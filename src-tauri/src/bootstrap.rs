//! 启动装配：解析全局目录、初始化日志与全局库、按记忆恢复当前工作区。

use crate::db::{self, paths};
use crate::errors::AppResult;
use crate::logging;
use crate::services::workspace_service;
use crate::state::AppState;

/// 创建应用状态；恢复失败不会阻止启动，前端会进入首次引导。
///
/// @returns 可交给 Tauri `manage` 的状态（全局库必须成功打开）
pub fn initialize() -> AppResult<AppState> {
    let global_paths = paths::GlobalPaths::resolve()?;
    if let Err(error) = logging::init(&global_paths.logs_dir) {
        // 日志不可写时仍允许使用应用，错误直接打到 stderr。
        eprintln!("starris logging init failed: {error}");
    }
    logging::info("app", "初始化全局工作区目录");

    let global = db::global::open(&global_paths.global_db)?;
    let state = AppState::new(global, None);
    if let Err(error) = workspace_service::restore_last_workspace(&state) {
        logging::error("app", &format!("启动恢复当前工作区失败: {error}"));
    }
    if let Ok(context) = crate::services::attachment_service::AttachmentContext::from_state(&state)
    {
        let days = crate::services::attachment_maintenance_service::settings(&context)
            .map(|settings| settings.trash_retention_days)
            .unwrap_or(30);
        if let Err(error) = crate::services::node_service::purge_expired_trash(&state, days) {
            logging::error("app", &format!("清理过期回收站失败: {error}"));
        }
    }
    Ok(state)
}
