//! 前端日志 IPC 适配层（AGENTS.md §10）：前端禁止自行写文件，统一经本命令写入全局日志。

use serde::Deserialize;

use crate::logging;

/// 前端日志等级，与 `logging` 模块的 info/debug/error 对应。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevelInput {
    /// 长期保留的事实与状态切换。
    Info,
    /// 仅排查细节；是否落盘由 `STARRIS_LOG_LEVEL` 门控。
    Debug,
    /// 失败/异常分支。
    Error,
}

/// 前端日志写入参数。
#[derive(Debug, Deserialize)]
pub struct LogWriteInput {
    /// 日志等级。
    pub level: LogLevelInput,
    /// 来源模块名（如 "perf"、"editor"）；超长截断，避免单行失控。
    pub source: String,
    /// 单行消息；换行折叠与按字符截断由日志层统一处理。
    pub message: String,
}

/// 写入一条前端日志。
///
/// 日志写入失败不向调用方报错（日志层自身吞掉 IO 错误），保证"记录日志"永不打断 UI 流程。
///
/// @param input.level 等级 info/debug/error
/// @param input.source 来源模块名，如 "perf"
/// @param input.message 单行消息，如 "fps=120 p95=8.1ms"
/// @example 前端 `invokeCommand("log_write", { input: { level: "info", source: "perf", message: "fps=60" } })`
#[tauri::command(async)]
pub fn log_write(input: LogWriteInput) {
    let source: String = input.source.trim().chars().take(48).collect();
    let source = if source.is_empty() { "app" } else { source.as_str() };
    match input.level {
        LogLevelInput::Info => logging::info(source, &input.message),
        LogLevelInput::Debug => logging::debug(source, &input.message),
        LogLevelInput::Error => logging::error(source, &input.message),
    }
}
