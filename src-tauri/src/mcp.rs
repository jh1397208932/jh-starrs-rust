//! MCP（Model Context Protocol）协议分发：客户端内置服务与测试共用。
//!
//! 传输不再由本模块负责：桌面端通过 `services::mcp_host` 在 127.0.0.1 上
//! 提供 HTTP JSON-RPC；工具执行全部走 `ai_service`，写入按权限直写或进入待审区。

use serde_json::{Value, json};

use crate::services::ai_service;
use crate::state::AppState;

const PROTOCOL_VERSION: &str = "2024-11-05";

/// 处理一条 JSON-RPC 请求，返回 result；不支持的方法/工具错误返回中文消息。
pub fn dispatch(state: &AppState, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "starris-mcp", "version": env!("CARGO_PKG_VERSION") }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({
            "tools": ai_service::tools().iter().map(|tool| json!({
                "name": tool.name,
                "description": tool.description,
                "inputSchema": (tool.input_schema)()
            })).collect::<Vec<_>>()
        })),
        "tools/call" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or("缺少工具名")?;
            let args = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let execution =
                ai_service::execute(state, name, &args).map_err(|error| error.to_string())?;
            // 序列化失败必须作为错误上报（由 HTTP 层转成 JSON-RPC error 信封），
            // 绝不能返回空字符串还标记成功，否则客户端会误以为拿到了空结果。
            // 错误消息只描述失败本身，不嵌入原始工具输出。
            let serialized = serde_json::to_string_pretty(&execution)
                .map_err(|_| "工具结果序列化失败，请重试或缩小查询范围".to_string())?;
            Ok(json!({
                "content": [{ "type": "text", "text": serialized }],
                "isError": execution.status == "denied"
            }))
        }
        other => Err(format!("不支持的方法: {other}")),
    }
}
