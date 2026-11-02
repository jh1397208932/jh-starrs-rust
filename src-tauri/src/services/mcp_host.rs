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
/// 工具调用的最长等待时间（秒）。人审批准走桌面 UI 的带外流程，不在这 60 秒内等待；
/// 超时只结束 HTTP 侧等待，阻塞任务不被取消，结果按“未知”回复客户端。
const TOOL_CALL_TIMEOUT_SECS: u64 = 60;
/// 快速开关时旧监听器可能尚未释放端口，重试绑定的最大次数与间隔（毫秒）。
const BIND_MAX_ATTEMPTS: u32 = 5;
const BIND_RETRY_INTERVAL_MS: u64 = 120;

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

/// 加锁 `HOST`；锁中毒时仍取回内部值。
///
/// 用 `unwrap_or_else(PoisonError::into_inner)` 而非 `if let Ok(..)`/`unwrap_or_default`：
/// 前者会静默丢状态更新、后者会凭空造出一个空值，两者都会让鉴权与状态展示失真。
fn lock_host() -> std::sync::MutexGuard<'static, HostState> {
    HOST.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// 加锁 `TOKEN`；中毒时同样取回内部真实令牌，保证鉴权不被静默降级。
fn lock_token() -> std::sync::MutexGuard<'static, String> {
    TOKEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

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
    lock_host().error = message;
}

/// 当前状态（运行中 / 已停用 / 启动失败）。
pub fn status(app: &AppHandle) -> AppResult<McpStatus> {
    let enabled = read_enabled(app)?;
    let (url, error) = {
        let host = lock_host();
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

/// 启动时调用：开关读取成功且为开启时异步拉起服务；失败只记录状态，不阻塞窗口首帧。
///
/// 读取设置失败时按保守策略不启动（凡涉及网络暴露的能力默认关闭），并把原因写入日志，
/// 用户可在设置页重新打开开关来显式启动。
pub fn ensure_started(app: &AppHandle) {
    let enabled = match read_enabled(app) {
        Ok(enabled) => enabled,
        Err(error) => {
            logging::error(
                "mcp",
                &format!("读取 MCP 开关设置失败，按保守策略不启动服务：{error}"),
            );
            false
        }
    };
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
    *lock_token() = token;
    logging::info("mcp", "MCP 访问令牌已重置");
    status(app)
}

/// 停止监听；正在处理的请求会在空闲后结束。
fn stop() {
    let mut host = lock_host();
    if let Some(running) = host.running.take() {
        let _ = running.shutdown.send(());
    }
}

/// 绑定 127.0.0.1 上的监听端口；带有限次重试。
///
/// 快速开关时上一次 `axum::serve` 任务可能还没把旧监听器释放掉，直接 bind 会报
/// EADDRINUSE。这里等待旧任务退出（监听器随 serve future 一起 drop），最多重试
/// `BIND_MAX_ATTEMPTS` 次；仍失败则返回明确错误供设置页展示。
async fn bind_with_retry(port: u16) -> AppResult<tokio::net::TcpListener> {
    let mut last_error: Option<std::io::Error> = None;
    for attempt in 1..=BIND_MAX_ATTEMPTS {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok(listener),
            Err(error) => last_error = Some(error),
        }
        if attempt < BIND_MAX_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(BIND_RETRY_INTERVAL_MS)).await;
        }
    }
    Err(match last_error {
        Some(error) => AppError::validation(format!(
            "MCP 端口 {port} 无法监听，旧监听器可能仍在释放，请稍后重试：{error}"
        )),
        None => AppError::Internal,
    })
}

/// 绑定端口并注册路由；已存在旧实例时先停掉。
async fn start(app: &AppHandle) -> AppResult<()> {
    stop();
    let token = ensure_token(app)?;
    *lock_token() = token;
    let port = std::env::var("STARRIS_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let listener = bind_with_retry(port).await?;
    let url = format!("http://127.0.0.1:{port}/mcp");
    let (shutdown, receiver) = oneshot::channel();
    let id = {
        let mut host = lock_host();
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
        let mut host = lock_host();
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
    // JSON-RPC 批量（数组）或其它非对象消息：本服务只实现单条请求，必须显式回
    // Invalid Request 信封（-32600），绝不能回 202 让客户端误以为批量已被执行。
    if !message.is_object() {
        return json_response(
            StatusCode::OK,
            json!({"jsonrpc": "2.0", "id": Value::Null, "error": {"code": -32600, "message": "Invalid Request：仅支持单条 JSON-RPC 请求对象，不支持批量数组"}}),
        );
    }
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
    let method_for_log = method.clone();
    // 给工具调用设超时上限，防止卡死的 SQLite 调用长期占用 handler 与阻塞线程池；
    // 超时后不取消阻塞任务（无法安全取消），只告知客户端结果未知。
    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(TOOL_CALL_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            let state = app.state::<AppState>();
            mcp::dispatch(&state, &method, &params)
        }),
    )
    .await;
    let outcome = match outcome {
        Err(_elapsed) => {
            logging::error(
                "mcp",
                &format!(
                    "MCP 方法 {method_for_log} 调用超过 {TOOL_CALL_TIMEOUT_SECS} 秒未返回，后台任务仍在运行"
                ),
            );
            return json_response(
                StatusCode::OK,
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": format!("操作超时（{} 秒）：请求可能仍在后台执行，最终结果未知，请先查询确认后再重试", TOOL_CALL_TIMEOUT_SECS)}}),
            );
        }
        Ok(joined) => joined,
    };
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
///
/// 令牌缺失/为空视为明确的错误状态：写入 `host.error`（设置页可见）并拒绝请求，
/// 不再静默地让所有请求 401 而状态仍显示运行中。
fn authorized(headers: &HeaderMap) -> bool {
    let header_value = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let Some(presented) = header_value.strip_prefix("Bearer ") else {
        return false;
    };
    let expected = lock_token().clone();
    if expected.is_empty() {
        set_error(Some(
            "MCP 访问令牌缺失，服务已拒绝所有请求；请在设置页重置令牌".to_string(),
        ));
        return false;
    }
    constant_time_eq(presented.trim().as_bytes(), expected.as_bytes())
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
