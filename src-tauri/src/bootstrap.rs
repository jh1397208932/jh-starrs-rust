//! 启动装配：同步只做日志与全局库；工作区初始化按登记表在后台异步执行。
//!
//! 规则：库表结构只在 `db::global` / `db::workspace` 的 `SCHEMA` 里定义；启动装配执行
//! `db::init_registry` 登记的全局任务，工作区库在打开会话时按当前 schema 初始化。

use tauri::{AppHandle, Emitter, Manager};

use crate::db::{self, paths};
use crate::errors::AppResult;
use crate::logging;
use crate::services::workspace_service;
use crate::state::AppState;

/// 前端等待的就绪事件名。
pub const BOOTSTRAP_EVENT: &str = "starris://bootstrap";

/// 创建应用状态：同步完成日志与全局库（菜单需要读取语言设置），工作区留给后台任务。
///
/// @returns 可交给 Tauri `manage` 的状态
pub fn initialize() -> AppResult<AppState> {
    let global_paths = paths::GlobalPaths::resolve()?;
    if let Err(error) = logging::init(&global_paths.logs_dir) {
        // 日志不可写时仍允许使用应用，错误直接打到 stderr。
        eprintln!("starris logging init failed: {error}");
    }
    logging::info("app", "初始化全局工作区目录");

    // 全局库只有两张小表：属于启动装配的一部分；版本不一致会在登记任务里直接报错。
    let mut global = db::global::open_connection(&global_paths.global_db)?;
    db::init_registry::run_tasks(&mut global, db::init_registry::GLOBAL_TASKS)?;
    Ok(AppState::new(global, None))
}

/// 后台启动初始化：恢复工作区（按登记表补齐结构）与维护任务。
///
/// 由 Tauri `setup` 以阻塞线程异步调用；完成后标记就绪并广播事件。
pub fn spawn_startup(app: AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        match run_startup(&state) {
            Ok(()) => state.bootstrap.mark_ready(),
            Err(error) => {
                logging::error("app", &format!("启动初始化失败: {error}"));
                state.bootstrap.mark_failed(error.to_string());
            }
        }
        let (ready, error) = state.bootstrap.status();
        let _ = app.emit(
            BOOTSTRAP_EVENT,
            serde_json::json!({ "ready": ready, "error": error }),
        );
    });
}

/// 执行工作区恢复与维护；桌面端启动与测试共用。
pub fn run_startup(state: &AppState) -> AppResult<()> {
    if let Err(error) = workspace_service::restore_last_workspace(state) {
        // 恢复失败不阻断启动，前端会进入首次引导；记日志即可。
        logging::error("app", &format!("启动恢复当前工作区失败: {error}"));
    }
    if let Ok(context) = crate::services::attachment_service::AttachmentContext::from_state(state) {
        let days = crate::services::attachment_maintenance_service::settings(&context)
            .map(|settings| settings.trash_retention_days)
            .unwrap_or(30);
        if let Err(error) = crate::services::node_service::purge_expired_trash(state, days) {
            logging::error("app", &format!("清理过期回收站失败: {error}"));
        }
    }
    Ok(())
}
