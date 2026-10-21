// 星屿 Starris Tauri 入口
// 窗口策略：macOS 用 titleBarStyle:"Overlay" 保留系统红绿灯（见 tauri.conf.json）；
// Windows/Linux 无系统标题栏，改为自绘右上角控制按钮（TitleBar.tsx），因此在此移除窗口装饰。

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|_app| {
            // Windows/Linux：移除系统窗口装饰（macOS 依赖 Overlay 保留红绿灯，勿动）
            #[cfg(not(target_os = "macos"))]
            {
                use tauri::Manager;
                if let Some(win) = _app.get_webview_window("main") {
                    let _ = win.set_decorations(false);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
