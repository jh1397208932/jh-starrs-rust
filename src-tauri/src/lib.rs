// 星屿 Starris Tauri 入口
// 窗口策略：macOS 用 titleBarStyle:"Overlay" 保留系统红绿灯（见 tauri.conf.json）；
// Windows/Linux 无系统标题栏，改为自绘右上角控制按钮（TitleBar.tsx），因此在此移除窗口装饰。

mod bootstrap;
mod commands;
mod db;
mod domain;
mod errors;
mod logging;
mod mcp;
mod menu;
mod models;
mod repositories;
mod services;
mod state;
mod utils;

#[cfg(test)]
mod integration_tests;

use std::time::Duration;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // 必须最先注册：第二个实例启动时直接聚焦已有窗口并退出。
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .on_menu_event(|app_handle, event| {
            if event.id() == menu::QUIT_MENU_ID {
                request_exit(app_handle);
            } else if event.id() == menu::FIND_MENU_ID
                && let Some(window) = app_handle.get_webview_window("main")
            {
                let _ = window.emit("starris://find", ());
            }
        })
        .setup(|app| {
            // 全局库打开失败属于不可恢复启动错误；工作区恢复失败则由前端进入引导页。
            let state = bootstrap::initialize()?;
            let locale = {
                let global = state.global()?;
                crate::repositories::settings_repository::get(
                    &global,
                    crate::models::SETTING_LOCALE,
                )?
                .unwrap_or_else(|| "zh-CN".to_string())
            };
            // macOS 挂原生菜单（Quit/Find 走自定义事件）；Windows/Linux 无边框窗口不挂菜单栏。
            if let Some(native_menu) = menu::build(app.handle(), &locale)? {
                app.set_menu(native_menu)?;
            }
            app.manage(state);
            bootstrap::spawn_startup(app.handle().clone());
            // MCP 是客户端能力：进程内起本机 HTTP 服务，随窗口启动；失败只记录状态。
            services::mcp_host::ensure_started(app.handle());
            services::attachment_maintenance_service::spawn_watchdog(app.handle().clone());
            // 开发/打包启动都把主窗口带到前台，避免后台启动时窗口不可交互。
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Windows/Linux：移除系统窗口装饰（macOS 依赖 Overlay 保留红绿灯，勿动）
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ai::ai_permissions_get,
            commands::ai::ai_permissions_set,
            commands::ai::ai_inbox_list,
            commands::ai::ai_inbox_approve,
            commands::ai::ai_inbox_reject,
            commands::ai::ai_audit_list,
            commands::mcp::mcp_status,
            commands::mcp::mcp_set_enabled,
            commands::mcp::mcp_regenerate_token,
            commands::app::app_bootstrap_status,
            commands::app::app_confirm_exit,
            commands::app::app_cancel_exit,
            commands::app::app_print_main_window,
            commands::log::log_write,
            commands::workspace::app_bootstrap,
            commands::workspace::workspace_list,
            commands::workspace::workspace_create,
            commands::workspace::workspace_open,
            commands::workspace::workspace_switch,
            commands::workspace::workspace_rename,
            commands::workspace::workspace_delete,
            commands::backup::backup_workspace,
            commands::backup::restore_workspace,
            commands::knowledge_base::kb_list,
            commands::knowledge_base::kb_get,
            commands::knowledge_base::kb_create,
            commands::knowledge_base::kb_update,
            commands::knowledge_base::kb_delete,
            commands::node::node_list,
            commands::node::node_create,
            commands::node::node_update,
            commands::node::node_delete,
            commands::node::node_trash_list,
            commands::node::node_restore,
            commands::node::node_trash_purge,
            commands::node::node_trash_empty,
            commands::node::node_move,
            commands::search::search_nodes,
            commands::search::node_network,
            commands::template::template_list,
            commands::template::template_save,
            commands::template::template_create_node,
            commands::template::template_delete,
            commands::memory::memory_load,
            commands::memory::memory_save,
            commands::document::doc_load,
            commands::document::doc_save,
            commands::history::doc_history_list,
            commands::history::doc_history_restore,
            commands::board::board_load,
            commands::board::board_save,
            commands::board::board_save_viewport,
            commands::mindmap::mindmap_load,
            commands::mindmap::mindmap_save,
            commands::mindmap::mindmap_save_viewport,
            commands::mindmap::mindmap_export,
            commands::mindmap::import_mindmaps,
            commands::library::library_list,
            commands::library::library_items,
            commands::library::library_import,
            commands::library::library_set_enabled,
            commands::library::library_delete,
            commands::export::export_document,
            commands::export::export_knowledge_base,
            commands::export::export_write_file,
            commands::dialog::dialog_pick_export_file,
            commands::dialog::dialog_pick_export_dir,
            commands::import::import_documents,
            commands::attachment::attachment_upload,
            commands::attachment::attachment_upload_to_tree,
            commands::attachment::attachment_list,
            commands::attachment::attachment_get,
            commands::attachment::attachment_get_by_node,
            commands::attachment::attachment_update,
            commands::attachment::attachment_delete,
            commands::attachment::attachment_download,
            commands::attachment::attachment_verify,
            commands::attachment::attachment_stats,
            commands::attachment::attachment_restore,
            commands::attachment::attachment_set_lifecycle,
            commands::attachment::attachment_maintenance,
            commands::attachment::attachment_maintenance_settings,
            commands::attachment::attachment_update_maintenance_settings,
            commands::attachment::attachment_upload_bytes,
            commands::attachment::attachment_read_bytes,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if commands::app::is_exit_allowed() {
                return;
            }
            // 用户退出前先让前端落盘；前端通过 app_confirm_exit 放行。
            api.prevent_exit();
            request_exit(app_handle);
        }
    });
}

/// 请求前端落盘后再退出；菜单 Quit 与 RunEvent 共用这一条路径。
fn request_exit(app_handle: &tauri::AppHandle) {
    if commands::app::is_exit_allowed() {
        app_handle.exit(0);
        return;
    }
    commands::app::begin_exit_request();
    logging::info("app", "收到退出请求，等待前端落盘");
    let Some(window) = app_handle.get_webview_window("main") else {
        commands::app::mark_exit_allowed();
        app_handle.exit(0);
        return;
    };
    if let Err(error) = window.emit("starris://exit-requested", ()) {
        // 窗口已销毁或前端不可达：不能把用户困在无法退出的状态。
        logging::error("app", &format!("退出事件发送失败: {error}"));
        commands::app::mark_exit_allowed();
        app_handle.exit(0);
        return;
    }
    // 前端没有响应（例如启动早期）时的兜底；前端取消保存会清除该路径。
    let fallback_handle = app_handle.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(12));
        if commands::app::should_force_exit() {
            logging::error("app", "退出保存等待超时，强制退出");
            commands::app::mark_exit_allowed();
            fallback_handle.exit(0);
        }
    });
}
