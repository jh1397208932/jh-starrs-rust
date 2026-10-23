// 星屿 Starris Tauri 入口
// 窗口策略：macOS 用 titleBarStyle:"Overlay" 保留系统红绿灯（见 tauri.conf.json）；
// Windows/Linux 无系统标题栏，改为自绘右上角控制按钮（TitleBar.tsx），因此在此移除窗口装饰。

mod bootstrap;
mod commands;
mod db;
mod domain;
mod errors;
mod logging;
mod models;
mod repositories;
mod services;
mod state;
mod utils;

#[cfg(test)]
mod integration_tests;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 全局库打开失败属于不可恢复启动错误；工作区恢复失败则由前端进入引导页。
            let state = bootstrap::initialize()?;
            app.manage(state);

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
            commands::workspace::app_bootstrap,
            commands::workspace::workspace_list,
            commands::workspace::workspace_create,
            commands::workspace::workspace_open,
            commands::workspace::workspace_switch,
            commands::workspace::workspace_rename,
            commands::workspace::workspace_delete,
            commands::knowledge_base::kb_list,
            commands::knowledge_base::kb_get,
            commands::knowledge_base::kb_create,
            commands::knowledge_base::kb_update,
            commands::knowledge_base::kb_delete,
            commands::node::node_list,
            commands::node::node_create,
            commands::node::node_update,
            commands::node::node_delete,
            commands::node::node_move,
            commands::memory::memory_load,
            commands::memory::memory_save,
            commands::document::doc_load,
            commands::document::doc_save,
            commands::attachment::attachment_upload,
            commands::attachment::attachment_list,
            commands::attachment::attachment_get,
            commands::attachment::attachment_update,
            commands::attachment::attachment_delete,
            commands::attachment::attachment_download,
            commands::attachment::attachment_verify,
            commands::attachment::attachment_stats,
            commands::attachment::attachment_upload_bytes,
            commands::attachment::attachment_read_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
