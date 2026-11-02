import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 窗口操作集（Tauri Window API 薄封装）。
 * 每次调用时才取 getCurrentWindow()——浏览器 dev（无 Tauri runtime）下
 * 同步调用会抛错，必须延迟到用户点击时获取（见架构说明.md）。
 */
export const windowActions = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  isMaximized: () => getCurrentWindow().isMaximized(),
};

/**
 * 首帧绘制后显示主窗口。
 *
 * 窗口在 tauri.conf 中以 `visible: false` 启动，等 HTML splash 画出来再显示，
 * 避免 WKWebView 首次绘制前的白屏；浏览器 dev 下没有 Tauri runtime，静默忽略。
 */
export async function showMainWindow(): Promise<void> {
  try {
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
  } catch {
    // 非 Tauri 环境：保持页面原样。
  }
}

/**
 * 执行窗口操作并整体捕获降级（lib 基础设施适配层，AGENTS.md §3.3：
 * 组件禁止直接 import @tauri-apps/api，统一经本文件调用）。
 *
 * @param action 窗口操作（返回 Promise）
 * @param label 操作中文名，用于降级提示
 * @param fallback 降级回调（浏览器 dev 下弹 toast）
 */
export function runWindowAction(
  action: () => Promise<void>,
  label: string,
  fallback: (label: string) => void,
) {
  try {
    action().catch(() => fallback(label));
  } catch {
    fallback(label);
  }
}

/**
 * 订阅窗口最大化状态：先回推一次当前值，之后在尺寸变化时刷新。
 *
 * WebView2/WKWebView 在拖拽缩放、双击标题栏、系统贴边时都会触发 resize，
 * 自绘标题栏据此切换「最大化 / 还原」图标。
 *
 * @param listener 状态回调（true = 最大化）
 * @returns 取消订阅函数；浏览器 dev 下为空实现
 * @example const off = await subscribeWindowMaximized(setMaximized);
 */
export async function subscribeWindowMaximized(listener: (maximized: boolean) => void): Promise<() => void> {
  const current = getCurrentWindow();
  let unlisten: (() => void) | undefined;
  try {
    listener(await current.isMaximized());
    unlisten = await current.onResized(async () => {
      try {
        listener(await current.isMaximized());
      } catch {
        // 窗口销毁中的 resize 回调失败可忽略。
      }
    });
  } catch {
    // 浏览器 dev 没有 Tauri 窗口：保持默认未最大化。
  }
  return () => unlisten?.();
}
