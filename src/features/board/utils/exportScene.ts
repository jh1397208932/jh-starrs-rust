/**
 * 画板导出：把场景交给 Excalidraw 官方导出工具，统一处理文件编码。
 * PNG/SVG 固定白底、关闭深色反色，保证分享与文档场景可读。
 */

import type { BoardAppState, BoardFile } from "@/types/board";

/** Excalidraw BinaryFiles；键为 fileId（当前等于全局 object_id）。 */
export type BoardBinaryFiles = Record<
  string,
  { id: string; mimeType: string; dataURL: string; created: number }
>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** 文本按 UTF-8 转 base64；用于 SVG 与 `.excalidraw`。 */
export function textToBase64(text: string): string {
  return toBase64(new TextEncoder().encode(text));
}

export function boardFilesToBinary(files: BoardFile[]): BoardBinaryFiles {
  return Object.fromEntries(
    files.map((file) => [
      file.id,
      { id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created },
    ]),
  );
}

function exportAppState(appState: Record<string, unknown> | BoardAppState): Record<string, unknown> {
  return { ...appState, exportBackground: true, exportWithDarkMode: false };
}

function visibleElements(elements: readonly unknown[]): unknown[] {
  return elements.filter((element) => {
    if (typeof element !== "object" || element === null) return true;
    return !(element as { isDeleted?: unknown }).isDeleted;
  });
}

/** 渲染 PNG（返回 base64，不含 data URL 前缀）。 */
export async function renderBoardPng(
  elements: readonly unknown[],
  appState: Record<string, unknown> | BoardAppState,
  files: BoardBinaryFiles,
): Promise<string> {
  const { exportToBlob } = await import("@excalidraw/excalidraw");
  const blob = await exportToBlob({
    elements: visibleElements(elements) as never,
    appState: exportAppState(appState) as never,
    files: files as never,
    mimeType: "image/png",
    exportPadding: 16,
  });
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** 渲染 SVG（返回完整 XML 字符串）。 */
export async function renderBoardSvg(
  elements: readonly unknown[],
  appState: Record<string, unknown> | BoardAppState,
  files: BoardBinaryFiles,
): Promise<string> {
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  const svg = await exportToSvg({
    elements: visibleElements(elements) as never,
    appState: exportAppState(appState) as never,
    files: files as never,
    exportPadding: 16,
  });
  return new XMLSerializer().serializeToString(svg);
}

/** 生成 Excalidraw 原生 JSON（含内嵌图片 files）。 */
export async function serializeBoardExcalidraw(
  elements: readonly unknown[],
  appState: Record<string, unknown> | BoardAppState,
  files: BoardBinaryFiles,
): Promise<string> {
  const { serializeAsJSON } = await import("@excalidraw/excalidraw");
  return serializeAsJSON(
    visibleElements(elements) as never,
    exportAppState(appState) as never,
    files as never,
    "local",
  );
}

/** 判断场景里是否有文件卡片；单文件 `.excalidraw` 无法携带其附件。 */
export function hasBoardFileCards(elements: readonly unknown[]): boolean {
  return elements.some((element) => {
    if (typeof element !== "object" || element === null) return false;
    const customData = (element as { customData?: Record<string, unknown> }).customData;
    return customData?.boardFileCard === true;
  });
}
