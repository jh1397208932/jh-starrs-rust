//! 应用菜单：macOS 默认 Quit 会直接走 `terminate:`，绕过 Tauri 的退出请求。
//! 这里保留常用菜单项，但把「退出」换成自定义事件，以便前端先落盘。

use tauri::AppHandle;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

/// macOS 应用菜单的自定义「退出」项 id。
pub const QUIT_MENU_ID: &str = "app.quit";
/// 文档内查找菜单项 id；WKWebView 会吞掉 Cmd+F，走原生菜单加速键。
pub const FIND_MENU_ID: &str = "app.find";

/// 构建应用菜单；结构对齐 Tauri 默认菜单，只替换 Quit。
pub fn build(app: &AppHandle, locale: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let en = locale == "en-US";
    let label = |english: &'static str, chinese: &'static str| -> &'static str {
        if en { english } else { chinese }
    };
    let about = PredefinedMenuItem::about(app, Some(label("About Starris", "关于星屿")), None)?;
    let separator = || PredefinedMenuItem::separator(app);
    let services = PredefinedMenuItem::services(app, Some(label("Services", "服务")))?;
    let hide = PredefinedMenuItem::hide(app, Some(label("Hide Starris", "隐藏星屿")))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some(label("Hide Others", "隐藏其他")))?;
    let quit = MenuItem::with_id(
        app,
        QUIT_MENU_ID,
        if en { "Quit Starris" } else { "退出星屿" },
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let find = MenuItem::with_id(
        app,
        FIND_MENU_ID,
        if en { "Find" } else { "查找" },
        true,
        Some("CmdOrCtrl+F"),
    )?;
    let close_file =
        PredefinedMenuItem::close_window(app, Some(label("Close Window", "关闭窗口")))?;
    let close_window =
        PredefinedMenuItem::close_window(app, Some(label("Close Window", "关闭窗口")))?;
    let minimize = PredefinedMenuItem::minimize(app, Some(label("Minimize", "最小化")))?;
    let maximize = PredefinedMenuItem::maximize(app, Some(label("Maximize", "最大化")))?;
    let fullscreen =
        PredefinedMenuItem::fullscreen(app, Some(label("Toggle Full Screen", "切换全屏")))?;
    let undo = PredefinedMenuItem::undo(app, Some(label("Undo", "撤销")))?;
    let redo = PredefinedMenuItem::redo(app, Some(label("Redo", "重做")))?;
    let cut = PredefinedMenuItem::cut(app, Some(label("Cut", "剪切")))?;
    let copy = PredefinedMenuItem::copy(app, Some(label("Copy", "复制")))?;
    let paste = PredefinedMenuItem::paste(app, Some(label("Paste", "粘贴")))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(label("Select All", "全选")))?;

    let app_menu = Submenu::with_items(
        app,
        "星屿 Starris",
        true,
        &[
            &about,
            &separator()?,
            &services,
            &separator()?,
            &hide,
            &hide_others,
            &separator()?,
            &quit,
        ],
    )?;
    let file_menu =
        Submenu::with_items(app, if en { "File" } else { "文件" }, true, &[&close_file])?;
    let edit_menu = Submenu::with_items(
        app,
        if en { "Edit" } else { "编辑" },
        true,
        &[
            &undo,
            &redo,
            &separator()?,
            &find,
            &separator()?,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;
    let view_menu =
        Submenu::with_items(app, if en { "View" } else { "显示" }, true, &[&fullscreen])?;
    let window_menu = Submenu::with_items(
        app,
        if en { "Window" } else { "窗口" },
        true,
        &[&minimize, &maximize, &separator()?, &close_window],
    )?;
    let help_menu = Submenu::with_items(app, if en { "Help" } else { "帮助" }, true, &[])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}
