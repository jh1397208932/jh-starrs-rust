/**
 * 前端统一日志（AGENTS.md §10）：业务代码禁止 `console.*`，一律使用本 util。
 *
 * - 攒批：缓冲 300ms 或满 16 条时统一冲刷，减少 IPC 次数；
 * - 页面隐藏 / 卸载时立即冲刷，避免退出前丢失；
 * - 等级门控在 Rust 层（`STARRIS_LOG_LEVEL`），`logDebug` 在 info 档不会落盘；
 * - 发送失败静默，日志永不阻断 UI。
 */

import { type LogLevel, writeLog } from "@/api/log";

/** 单条待发送日志。 */
interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
}

const FLUSH_DELAY_MS = 300;
const FLUSH_MAX_ENTRIES = 16;

let queue: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

/** 把日志放入缓冲；缓冲满时立即冲刷。 */
function enqueue(entry: LogEntry): void {
  queue.push(entry);
  if (queue.length >= FLUSH_MAX_ENTRIES) {
    flush();
    return;
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/** 把缓冲中的日志逐条送出；失败静默。 */
function flush(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue;
  queue = [];
  for (const entry of batch) {
    void writeLog(entry.level, entry.source, entry.message).catch(() => undefined);
  }
}

/** 安装页面隐藏/卸载时的兜底冲刷；整个生命周期只装一次。 */
function installFlushListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

/**
 * 记录长期保留的信息级日志（事实、状态切换）。
 * @param source 来源模块名
 * @param message 单行消息
 * @example logInfo("editor", "文档已保存 nodeId=node-1 字数=1200")
 */
export function logInfo(source: string, message: string): void {
  installFlushListeners();
  enqueue({ level: "info", source, message });
}

/**
 * 记录排查细节日志；仅当 `STARRIS_LOG_LEVEL=debug` 时落盘。
 * @param source 来源模块名
 * @param message 单行消息
 * @example logDebug("perf", "缓存命中 count=12")
 */
export function logDebug(source: string, message: string): void {
  installFlushListeners();
  enqueue({ level: "debug", source, message });
}

/**
 * 记录失败/异常分支日志（写入 error 级别）。
 * @param source 来源模块名
 * @param message 单行失败描述（不含令牌等敏感信息）
 * @example logFailure("editor", "文档保存失败，已保留 dirty 状态")
 */
export function logFailure(source: string, message: string): void {
  installFlushListeners();
  enqueue({ level: "error", source, message });
}
