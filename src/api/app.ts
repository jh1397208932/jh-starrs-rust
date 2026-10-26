//! 应用退出 IPC 与窗口关闭事件封装。

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type CloseRequestedEvent, getCurrentWindow } from "@tauri-apps/api/window";
import { invokeCommand } from "./client";

/**
 * 监听 Rust 发来的退出请求（`⌘Q`/菜单/系统退出）。
 * 浏览器 dev 没有 Tauri runtime 时返回空清理函数，避免页面崩溃。
 * @param handler 收到退出请求后的处理逻辑
 * @returns 取消监听的函数
 * @example const unlisten = await onExitRequested(() => flushAndExit());
 */
export async function onExitRequested(handler: () => void | Promise<void>): Promise<UnlistenFn> {
  try {
    return await listen("starris://exit-requested", () => {
      void handler();
    });
  } catch {
    return () => undefined;
  }
}

/**
 * 监听窗口关闭请求（红绿灯、关闭窗口）。
 * @param handler 关闭处理逻辑；可调用 event.preventDefault() 阻止关闭
 * @returns 取消监听的函数
 */
export async function onWindowCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  try {
    return await getCurrentWindow().onCloseRequested(handler);
  } catch {
    return () => undefined;
  }
}

/**
 * 监听原生菜单「查找」请求；WKWebView 会截获 Cmd+F，菜单加速键更可靠。
 * @param handler 收到查找请求后的处理逻辑
 * @returns 取消监听的函数
 */
export async function onFindRequested(handler: () => void): Promise<UnlistenFn> {
  try {
    return await listen("starris://find", () => handler());
  } catch {
    return () => undefined;
  }
}

/**
 * 打开系统打印面板；调用前应先 flush 当前文档。
 * @example await printMainWindow();
 */
export async function printMainWindow(): Promise<void> {
  await invokeCommand("app_print_main_window");
}

/**
 * 前端确认已完成落盘，允许应用退出。
 * @example await confirmAppExit();
 */
export async function confirmAppExit(): Promise<void> {
  await invokeCommand("app_confirm_exit");
}

/**
 * 前端取消本次退出（保存失败/超时），保持应用运行。
 * @example await cancelAppExit();
 */
export async function cancelAppExit(): Promise<void> {
  await invokeCommand("app_cancel_exit");
}
