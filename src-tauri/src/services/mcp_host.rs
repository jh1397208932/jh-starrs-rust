//! 客户端内置 MCP 服务：随桌面端启动/停止，仅监听 127.0.0.1。
//!
//! 传输为 HTTP + JSON-RPC 2.0（`POST /mcp`）；请求必须携带启动时生成/读取的
//! Bearer 令牌。工具执行复用客户端当前 `AppState`（同一工作区连接、同一权限与
//! 待审区），因此 MCP 是客户端能力，而不是可独立运行的服务程序。

use std::sync::{LazyLock, Mutex};

use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use crate::errors::{AppError, AppResult};
use crate::models::{SETTING_MCP_ENABLED, SETTING_MCP_TOKEN};
use crate::repositories::settings_repository;
use crate::state::AppState;
use crate::utils::{new_id, now_ms};
use crate::{logging, mcp};

/// 默认端口；`STARRIS_MCP_PORT` 可覆盖（测试用例使用固定测试端口）。
const DEFAULT_PORT: u16 = 47821;
/// 请求体上限：MCP 只传 JSON 参数，4 MiB 足够且能挡住异常大包。
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

struct RunningServer {
    id: u64,
    url: String,
    shutdown: oneshot::Sender<()>,
}

#[derive(Default)]
struct HostState {
    running: Option<RunningServer>,
    error: Option<String>,
    next_id: u64,
}

static HOST: LazyLock<Mutex<HostState>> = LazyLock::new(|| Mutex::new(HostState::default()));
/// 当前令牌。请求线程每次读取，重置令牌无需重启监听。
static TOKEN: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new(String::new()));

/// 设置页展示用的 MCP 状态。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    /// 设置里的开关（关闭后不监听端口）
    pub enabled: bool,
    /// 当前是否已成功监听
    pub running: bool,
    /// 监听成功时的 MCP 端点
    pub url: Option<String>,
    /// 当前 Bearer 令牌（用于配置 agent）
    pub token: String,
    /// 启动/运行错误（端口占用等）
    pub error: Option<String>,
}

/// 读取设置中的开关（默认开启：能力随客户端提供）。
fn read_enabled(app: &AppHandle) -> AppResult<bool> {
    let state = app.state::<AppState>();
    let guard = state.global()?;
    let value = settings_repository::get(&guard, SETTING_MCP_ENABLED)?;
    Ok(value.as_deref() != Some("0"))
}

/// 读取或首次生成令牌，写回全局库。
fn ensure_token(app: &AppHandle) -> AppResult<String> {
    let state = app.state::<AppState>();
    let guard = state.global()?;
    if let Some(token) = settings_repository::get(&guard, SETTING_MCP_TOKEN)?
        && !token.is_empty()
    {
        return Ok(token);
    }
    let token = generate_token();
    settings_repository::set(&guard, SETTING_MCP_TOKEN, &token, now_ms())?;
    logging::info("mcp", "已生成新的 MCP 访问令牌");
    Ok(token)
}

/// 64 位十六进制随机串（两次 UUIDv7 拼接去分隔符）。
fn generate_token() -> String {
    format!("{}{}", new_id().replace('-', ""), new_id().replace('-', ""))
}

fn set_error(message: Option<String>) {
    if let Ok(mut host) = HOST.lock() {
        host.error = message;
    }
}

/// 当前状态（运行中 / 已停用 / 启动失败）。
pub fn status(app: &AppHandle) -> AppResult<McpStatus> {
    let enabled = read_enabled(app)?;
    let (url, error) = {
        let host = HOST.lock().map_err(|_| AppError::Internal)?;
        (
            host.running.as_ref().map(|running| running.url.clone()),
            host.error.clone(),
        )
    };
    let token = ensure_token(app)?;
    Ok(McpStatus {
        enabled,
        running: url.is_some(),
        url,
        token,
        error,
    })
}

/// 启动时调用：默认开启时异步拉起服务；失败只记录状态，不阻塞窗口首帧。
pub fn ensure_started(app: &AppHandle) {
    let enabled = read_enabled(app).unwrap_or(true);
    if !enabled {
        return;
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = start(&handle).await {
            set_error(Some(error.to_string()));
            logging::error("mcp", &format!("MCP 服务启动失败: {error}"));
        }
    });
}

/// 开关服务：写设置后立即启动/停止，并把最终状态返回给设置页。
pub async fn set_enabled(app: &AppHandle, enabled: bool) -> AppResult<McpStatus> {
    {
        let state = app.state::<AppState>();
        let guard = state.global()?;
        settings_repository::set(
            &guard,
            SETTING_MCP_ENABLED,
            if enabled { "1" } else { "0" },
            now_ms(),
        )?;
    }
    if enabled {
        if let Err(error) = start(app).await {
            set_error(Some(error.to_string()));
            logging::error("mcp", &format!("MCP 服务启动失败: {error}"));
        }
    } else {
        stop();
        set_error(None);
        logging::info("mcp", "MCP 服务已按设置停止");
    }
    status(app)
}

/// 重置令牌：旧配置立即失效，服务无需重启。
pub fn regenerate_token(app: &AppHandle) -> AppResult<McpStatus> {
    let token = generate_token();
    {
        let state = app.state::<AppState>();
        let guard = state.global()?;
        settings_repository::set(&guard, SETTING_MCP_TOKEN, &token, now_ms())?;
    }
    if let Ok(mut current) = TOKEN.lock() {
        *current = token;
    }
    logging::info("mcp", "MCP 访问令牌已重置");
    status(app)
}

/// 停止监听；正在处理的请求会在空闲后结束。
fn stop() {
    if let Ok(mut host) = HOST.lock()
        && let Some(running) = host.running.take()
    {
        let _ = running.shutdown.send(());
    }
}

/// 绑定端口并注册路由；已存在旧实例时先停掉。
async fn start(app: &AppHandle) -> AppResult<()> {
    stop();
    let token = ensure_token(app)?;
    if let Ok(mut current) = TOKEN.lock() {
        *current = token;
    }
    let port = std::env::var("STARRIS_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| AppError::validation(format!("MCP 端口 {port} 无法监听：{error}")))?;
    let url = format!("http://127.0.0.1:{port}/mcp");
    let (shutdown, receiver) = oneshot::channel();
    let id = {
        let mut host = HOST.lock().map_err(|_| AppError::Internal)?;
        host.next_id += 1;
        let id = host.next_id;
        host.running = Some(RunningServer {
            id,
            url: url.clone(),
            shutdown,
        });
        host.error = None;
        id
    };
    let router = Router::new()
        .route("/mcp", post(handle_rpc))
        .route("/health", get(health))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(Ctx { app: app.clone() });
    tauri::async_runtime::spawn(async move {
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = receiver.await;
            })
            .await;
        let mut host = match HOST.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        // 只有仍是本次启动的实例才清空状态，避免旧任务把新服务标记为未运行。
        if host
            .running
            .as_ref()
            .is_some_and(|running| running.id == id)
        {
            host.running = None;
        }
        if let Err(error) = result {
            logging::error("mcp", &format!("MCP 服务异常退出: {error}"));
            host.error = Some(format!("MCP 服务异常退出：{error}"));
        }
    });
    logging::info("mcp", &format!("MCP 服务已启动 {url}"));
    Ok(())
}

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

/// 处理一次 JSON-RPC 调用：鉴权 → 解析 → 在阻塞线程执行工具（不占用 async worker）。
async fn handle_rpc(State(ctx): State<Ctx>, headers: HeaderMap, body: Bytes) -> Response {
    if !authorized(&headers) {
        return json_response(
            StatusCode::UNAUTHORIZED,
            json!({"jsonrpc": "2.0", "id": Value::Null, "error": {"code": -32001, "message": "unauthorized"}}),
        );
    }
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({"jsonrpc": "2.0", "id": Value::Null, "error": {"code": -32700, "message": "Parse error"}}),
        );
    };
    // 通知（无 id）不需要响应；MCP 客户端只关心 202。
    let Some(id) = message.get("id").cloned() else {
        return StatusCode::ACCEPTED.into_response();
    };
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let app = ctx.app.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        let state = app.state::<AppState>();
        mcp::dispatch(&state, &method, &params)
    })
    .await;
    match outcome {
        Ok(Ok(result)) => json_response(
            StatusCode::OK,
            json!({"jsonrpc": "2.0", "id": id, "result": result}),
        ),
        Ok(Err(message)) => json_response(
            StatusCode::OK,
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": message}}),
        ),
        Err(error) => json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32603, "message": format!("内部错误：{error}")}}),
        ),
    }
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
        .into_response()
}

/// Bearer 令牌校验；比较过程不因前缀相同而提前返回。
fn authorized(headers: &HeaderMap) -> bool {
    let header_value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let Some(presented) = header_value.strip_prefix("Bearer ") else {
        return false;
    };
    let expected = TOKEN.lock().map(|guard| guard.clone()).unwrap_or_default();
    !expected.is_empty() && constant_time_eq(presented.trim().as_bytes(), expected.as_bytes())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right) {
        diff |= a ^ b;
    }
    diff == 0
}
