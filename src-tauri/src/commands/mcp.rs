//! MCP 托管服务命令：设置页读取状态、开关与重置令牌。

use tauri::AppHandle;

use crate::errors::AppResult;
use crate::services::mcp_host::{self, McpStatus};

/// 读取 MCP 服务状态（开关、是否运行、端点、令牌、错误）。
#[tauri::command]
pub async fn mcp_status(app: AppHandle) -> AppResult<McpStatus> {
    mcp_host::status(&app)
}

/// 开关 MCP 服务，返回最新状态；开启失败时状态里带可读原因。
#[tauri::command]
pub async fn mcp_set_enabled(app: AppHandle, enabled: bool) -> AppResult<McpStatus> {
    mcp_host::set_enabled(&app, enabled).await
}

/// 重置 MCP 访问令牌；旧令牌立即失效，服务无需重启。
#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle) -> AppResult<McpStatus> {
    mcp_host::regenerate_token(&app)
}
