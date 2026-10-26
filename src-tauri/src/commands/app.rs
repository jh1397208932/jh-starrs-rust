//! 应用退出协调：前端完成落盘后再允许 Tauri 退出。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

/// 前端已确认可以退出；`RunEvent::ExitRequested` 看到它时不再拦截。
static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);
/// 本次退出请求已被前端取消（保存失败/超时），兜底定时器不得强制退出。
static EXIT_CANCELLED: AtomicBool = AtomicBool::new(false);

/// 是否已经允许退出；只供 run loop 判断。
pub fn is_exit_allowed() -> bool {
    EXIT_ALLOWED.load(Ordering::SeqCst)
}

/// 是否仍未确认且未被取消；兜底定时器据此决定是否强制退出。
pub fn should_force_exit() -> bool {
    !EXIT_ALLOWED.load(Ordering::SeqCst) && !EXIT_CANCELLED.load(Ordering::SeqCst)
}

/// 开始一轮退出请求：清除上一轮的取消标记。
pub fn begin_exit_request() {
    EXIT_CANCELLED.store(false, Ordering::SeqCst);
}

/// 设置允许退出标志；供退出确认命令与兜底路径共用。
pub fn mark_exit_allowed() {
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
}

/// 前端确认落盘完成：允许退出并触发应用退出。
#[tauri::command]
pub fn app_confirm_exit(app: AppHandle) {
    mark_exit_allowed();
    app.exit(0);
}

/// 前端取消退出（保存失败或超时）：保持应用运行，兜底定时器不再强制退出。
#[tauri::command]
pub fn app_cancel_exit() {
    EXIT_CANCELLED.store(true, Ordering::SeqCst);
}

/// 打开系统打印面板；由前端在落盘后调用。
#[tauri::command(async)]
pub fn app_print_main_window(app: AppHandle) -> crate::errors::AppResult<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Err(crate::errors::AppError::Internal);
    };
    window.print().map_err(|error| {
        crate::logging::error("app", &format!("打开打印面板失败: {error}"));
        crate::errors::AppError::Internal
    })
}
