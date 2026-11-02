/**
 * 文档内嵌预览生成：用官方导出器把画板/思维导图渲染成 PNG，写回对象库。
 *
 * 渲染必须在渲染端完成（Excalidraw 导出器 / 导图 SVG 光栅化），后端只存对象。
 * 同一源节点的生成请求单飞，避免多个嵌入块同时渲染同一张画板。
 */

import { loadBoard } from "@/api/board";
import { toErrorMessage } from "@/api/client";
import { loadMindmap } from "@/api/mindmap";
import { getBoardImage, getMindmapImage, saveNodePreview } from "@/api/preview";
import { boardFilesToBinary, renderBoardPng } from "@/features/board/utils/exportScene";
import { renderMindmapSvg, svgToPngBlob } from "@/features/mindmap/utils/exportGraphics";
import { readMindmapExportTheme } from "@/features/mindmap/utils/exportTheme";
import { logFailure } from "@/lib/logger";
import {
  NODE_PREVIEW_UPDATED_EVENT,
  type NodePreview,
  type NodePreviewUpdatedDetail,
  type PreviewKind,
} from "@/types/preview";

/** 预览图最长边；文档里是缩略图，不需要原始画布尺寸。 */
const PREVIEW_MAX_EDGE = 1600;
/** 保存静止后延迟导出，避免自动保存过程中反复渲染。 */
const PREVIEW_DELAY_MS = 1200;
const inflight = new Map<string, Promise<NodePreview | null>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 按 id 读取已存预览；不存在返回 null。 */
export function fetchNodePreview(kind: PreviewKind, nodeId: string): Promise<NodePreview | null> {
  return kind === "board" ? getBoardImage(nodeId) : getMindmapImage(nodeId);
}

/**
 * 源保存静止后安排一次导出；同一节点多次调用只保留最后一次。
 * 只由画板/导图视图调用，文档内嵌块不触发渲染。
 */
export function scheduleNodePreview(kind: PreviewKind, nodeId: string, title = ""): void {
  const key = `${kind}:${nodeId}`;
  const running = timers.get(key);
  if (running) clearTimeout(running);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void ensureNodePreview(kind, nodeId, title);
    }, PREVIEW_DELAY_MS),
  );
}

/**
 * 确保某节点有可用预览：单飞生成并写入对象库。
 * @param kind 画板或思维导图
 * @param nodeId 源节点 id
 * @param title 导图导出时的标题（画板忽略）
 * @returns 预览；源为空或生成失败返回 null
 */
export function ensureNodePreview(
  kind: PreviewKind,
  nodeId: string,
  title = "",
): Promise<NodePreview | null> {
  const key = `${kind}:${nodeId}`;
  const running = inflight.get(key);
  if (running) return running;
  const task = generate(kind, nodeId, title).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function generate(kind: PreviewKind, nodeId: string, title: string): Promise<NodePreview | null> {
  try {
    // 已有且不过期：直接复用，不再读取源场景。
    const existing = await fetchNodePreview(kind, nodeId);
    if (existing && !existing.stale) return existing;
    const preview =
      kind === "board" ? await renderBoardPreview(nodeId) : await renderMindmapPreview(nodeId, title);
    if (preview) {
      window.dispatchEvent(
        new CustomEvent<NodePreviewUpdatedDetail>(NODE_PREVIEW_UPDATED_EVENT, {
          detail: { kind, nodeId },
        }),
      );
    }
    return preview ?? existing;
  } catch (error) {
    logFailure("preview", `内嵌预览生成失败 ${kind}:${nodeId} ${toErrorMessage(error)}`);
    return null;
  }
}

async function renderBoardPreview(nodeId: string): Promise<NodePreview | null> {
  const board = await loadBoard(nodeId);
  if (board.elements.length === 0) return null;
  const base64 = await renderBoardPng(
    board.elements,
    board.appState as unknown as Record<string, unknown>,
    boardFilesToBinary(board.files),
  );
  const sized = await capPngBlob(base64ToBlob(base64), PREVIEW_MAX_EDGE);
  await saveNodePreview({
    nodeId,
    dataBase64: sized.base64,
    width: sized.width,
    height: sized.height,
    sourceUpdatedAt: board.updatedAt,
  });
  return {
    nodeId,
    dataUrl: `data:image/png;base64,${sized.base64}`,
    width: sized.width,
    height: sized.height,
    sourceUpdatedAt: board.updatedAt,
    stale: false,
  };
}

async function renderMindmapPreview(nodeId: string, title: string): Promise<NodePreview | null> {
  const mindmap = await loadMindmap(nodeId);
  const images = new Map(mindmap.images.map((file) => [file.id, file]));
  const svg = renderMindmapSvg(mindmap.content, title, images, readMindmapExportTheme());
  const png = await svgToPngBlob(svg, 1);
  const sized = await capPngBlob(png, PREVIEW_MAX_EDGE);
  await saveNodePreview({
    nodeId,
    dataBase64: sized.base64,
    width: sized.width,
    height: sized.height,
    sourceUpdatedAt: mindmap.updatedAt,
  });
  return {
    nodeId,
    dataUrl: `data:image/png;base64,${sized.base64}`,
    width: sized.width,
    height: sized.height,
    sourceUpdatedAt: mindmap.updatedAt,
    stale: false,
  };
}

interface SizedPng {
  base64: string;
  width: number;
  height: number;
}

/** 超过最长边的图片按比例缩小，避免把整张画板塞进文档。 */
async function capPngBlob(blob: Blob, maxEdge: number): Promise<SizedPng> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (scale >= 1) {
    const base64 = await blobToBase64(blob);
    bitmap.close();
    return { base64, width, height };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("画布不可用");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const scaled = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((next) => (next ? resolve(next) : reject(new Error("PNG 编码失败"))), "image/png");
  });
  return { base64: await blobToBase64(scaled), width, height };
}

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/png" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
