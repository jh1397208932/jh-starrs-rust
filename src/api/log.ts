import { invokeCommand } from "@/api/client";

/** 前端日志等级（与 Rust `logging` 模块的 info/debug/error 对应） */
export type LogLevel = "info" | "debug" | "error";

/**
 * 写入一条前端日志（AGENTS.md §10：前端不落盘，统一走 Rust `log_write` 命令）。
 *
 * @param level 日志等级：info 长期保留；debug 受 STARRIS_LOG_LEVEL 门控；error 失败分支
 * @param source 来源模块名（如 "perf"、"editor"）
 * @param message 单行消息（换行由 Rust 层折叠，超长截断）
 * @returns 无返回值；写入失败静默（不阻断 UI）
 * @example await writeLog("info", "perf", "fps=120 p50=8.1ms p95=9.3ms")
 */
export async function writeLog(level: LogLevel, source: string, message: string): Promise<void> {
  await invokeCommand("log_write", { input: { level, source, message } });
}
