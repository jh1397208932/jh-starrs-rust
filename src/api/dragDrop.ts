/**
 * 系统文件拖放事件封装（Tauri webview）。
 *
 * Tauri 的 `dragDropEnabled` 默认为 true，由框架在原生层接管从访达拖入的文件，
 * 网页因此收不到 HTML5 `drop`，`dataTransfer.files` 也是空的。
 * 所以外部文件拖放只能订阅这条 webview 事件，组件不得直接依赖 @tauri-apps/api（AGENTS.md §3.3）。
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";

/** 一次原生文件拖放的解析结果。 */
export interface NativeFileDrop {
  /** 被拖入文件的绝对路径，可直接交给路径流式上传。 */
  paths: string[];
  /** 落点横坐标，已换算为视口 CSS 像素。 */
  clientX: number;
  /** 落点纵坐标，已换算为视口 CSS 像素。 */
  clientY: number;
}

/**
 * 监听从系统文件管理器放进本窗口的文件。
 * @param onDrop 放下文件时的回调；enter/over/leave 与不含路径的事件会被忽略
 * @returns 取消监听的函数
 * @example const unlisten = await onNativeFileDrop((drop) => upload(drop.paths));
 */
export async function onNativeFileDrop(onDrop: (drop: NativeFileDrop) => void): Promise<() => void> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type !== "drop" || payload.paths.length === 0) return;
    // 事件坐标是相对 webview 左上角的物理像素；webview 铺满窗口，故等于视口原点。
    const ratio = window.devicePixelRatio || 1;
    onDrop({
      paths: payload.paths,
      clientX: payload.position.x / ratio,
      clientY: payload.position.y / ratio,
    });
  });
}
