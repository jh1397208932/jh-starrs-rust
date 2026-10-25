/**
 * 画板文件接入：非图片文件上传全局对象库后，生成带格式图标的文件卡片。
 * 图片交给 Excalidraw 原生 image + generateIdForFile 处理。
 */

import { useCallback } from "react";
import { uploadAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";

/** 画板只需要的最小 Excalidraw API 子集，避免静态 import 整个包。 */
export interface BoardCanvasApi {
  getAppState(): {
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
    width: number;
    height: number;
  };
  getSceneElements(): readonly unknown[];
  getFiles(): Record<string, { id: string; mimeType: string; dataURL: string; created: number }>;
  updateScene(scene: { elements: readonly unknown[] }): void;
  updateLibrary?(opts: { libraryItems: readonly unknown[]; merge?: boolean }): Promise<unknown>;
  /** 切换当前绘图工具；Excalidraw 公共 API。 */
  setActiveTool?(tool: { type: string }): void;
}

/** 可插入画板的既有全局对象（不重新上传）。 */
export interface BoardAttachmentRecord {
  objectId: string;
  name: string;
  mime: string;
  size: number;
}

interface UseBoardFileIntakeOptions {
  nodeId: string;
  api: BoardCanvasApi | null;
  onError: (message: string) => void;
}

interface Point {
  x: number;
  y: number;
}

interface FileStyle {
  label: string;
  color: string;
}

const TEXT = "#1D201F";
const MUTED = "#626663";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#D7E0DC";
const CARD_WIDTH = 248;
const CARD_HEIGHT = 88;

/** 按 MIME/扩展名给出卡片徽标与类型色；颜色是画布内容，不接受 CSS 变量。 */
function styleOf(name: string, mime: string): FileStyle {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.includes("pdf") || extension === "pdf") return { label: "PDF", color: "#C0554E" };
  if (["doc", "docx", "rtf"].includes(extension)) return { label: "DOC", color: "#5B8FB5" };
  if (["xls", "xlsx", "csv"].includes(extension)) return { label: "XLS", color: "#64906F" };
  if (["ppt", "pptx", "key"].includes(extension)) return { label: "PPT", color: "#B08A55" };
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(extension)) {
    return { label: "IMG", color: "#C9AD77" };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension)) return { label: "ZIP", color: "#C9AD77" };
  if (["mp3", "wav", "m4a", "flac"].includes(extension)) return { label: "AUD", color: "#7C82B8" };
  if (["mp4", "mov", "mkv", "webm"].includes(extension)) return { label: "VID", color: "#7C82B8" };
  if (["json", "md", "txt", "ts", "tsx", "js", "jsx", "rs", "py", "go"].includes(extension)) {
    return { label: "TXT", color: "#2F5C51" };
  }
  return { label: "FILE", color: MUTED };
}

/** 卡片上的文件大小。 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件名过长时截断，避免撑破卡片。 */
function displayName(name: string): string {
  return name.length > 30 ? `${name.slice(0, 27)}…` : name;
}

/**
 * 画板文件粘贴/拖放处理。
 * @param options 节点、画布 API 与错误回调
 * @returns onPaste / onDropCapture 与手动插入方法
 */
export function useBoardFileIntake({ nodeId, api, onError }: UseBoardFileIntakeOptions) {
  /** 把全局对象 id 渲染为文件卡片；不读取对象字节。 */
  const insertCards = useCallback(
    async (records: BoardAttachmentRecord[], origin?: Point) => {
      if (!api || records.length === 0) return;
      const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
      const appState = api.getAppState();
      const center = origin ?? {
        x: appState.width / (2 * appState.zoom.value) - appState.scrollX,
        y: appState.height / (2 * appState.zoom.value) - appState.scrollY,
      };
      const skeletons: Parameters<typeof convertToExcalidrawElements>[0] = [];
      for (const [index, record] of records.entries()) {
        const style = styleOf(record.name, record.mime);
        const x = center.x + (index % 3) * 26;
        const y = center.y + Math.floor(index / 3) * 26;
        const groupId = crypto.randomUUID();
        const card = {
          type: "rectangle" as const,
          x,
          y,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          strokeColor: CARD_BORDER,
          backgroundColor: CARD_BG,
          fillStyle: "solid" as const,
          strokeWidth: 1,
          strokeStyle: "solid" as const,
          roughness: 0,
          roundness: { type: 3 as const },
          groupIds: [groupId],
          customData: {
            boardFileCard: true,
            objectId: record.objectId,
            name: record.name,
            mime: record.mime,
            size: record.size,
          },
        };
        skeletons.push(card as never);
        skeletons.push({
          type: "rectangle",
          x: x + 12,
          y: y + 22,
          width: 36,
          height: 44,
          strokeColor: style.color,
          backgroundColor: style.color,
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          roundness: { type: 3 },
          groupIds: [groupId],
        } as never);
        skeletons.push({
          type: "text",
          x: x + 17,
          y: y + 34,
          width: 26,
          height: 16,
          text: style.label,
          fontSize: 9,
          fontFamily: 2,
          textAlign: "center",
          verticalAlign: "middle",
          strokeColor: "#FFFFFF",
          groupIds: [groupId],
        } as never);
        skeletons.push({
          type: "text",
          x: x + 60,
          y: y + 18,
          width: 172,
          height: 22,
          text: displayName(record.name),
          fontSize: 14,
          fontFamily: 2,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: TEXT,
          groupIds: [groupId],
        } as never);
        skeletons.push({
          type: "text",
          x: x + 60,
          y: y + 46,
          width: 172,
          height: 18,
          text: `${formatSize(record.size)} · ${style.label}`,
          fontSize: 10,
          fontFamily: 2,
          textAlign: "left",
          verticalAlign: "top",
          strokeColor: MUTED,
          groupIds: [groupId],
        } as never);
      }
      const cards = convertToExcalidrawElements(skeletons);
      // updateScene 替换整个场景；保留现有图元并把卡片追加到末尾。
      api.updateScene({ elements: [...api.getSceneElements(), ...cards] });
    },
    [api],
  );

  const insertFiles = useCallback(
    async (files: File[], origin?: Point) => {
      if (!api || files.length === 0) return;
      const records: BoardAttachmentRecord[] = [];
      let failed = 0;
      for (const file of files) {
        try {
          const attachment = await uploadAttachmentBytes(file, `画板/${nodeId}`);
          records.push({
            objectId: attachment.id,
            name: file.name,
            mime: file.type || "application/octet-stream",
            size: file.size,
          });
        } catch (error) {
          failed += 1;
          onError(toErrorMessage(error));
        }
      }
      if (records.length > 0) await insertCards(records, origin);
      if (failed > 0) onError(`${failed} 个文件上传失败，其余文件已插入画板`);
    },
    [api, insertCards, nodeId, onError],
  );

  const onPaste = useCallback(
    (_data: unknown, event: ClipboardEvent | null): boolean => {
      const files = Array.from(event?.clipboardData?.files ?? []).filter(
        (file) => !file.type.startsWith("image/"),
      );
      if (files.length === 0) return false;
      void insertFiles(files);
      return true;
    },
    [insertFiles],
  );

  const onDropCapture = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter(
        (file) => !file.type.startsWith("image/"),
      );
      if (files.length === 0 || !api) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        try {
          const { viewportCoordsToSceneCoords } = await import("@excalidraw/excalidraw");
          const point = viewportCoordsToSceneCoords(
            { clientX: event.clientX, clientY: event.clientY },
            api.getAppState() as never,
          );
          await insertFiles(files, point);
        } catch (error) {
          onError(toErrorMessage(error));
        }
      })();
    },
    [api, insertFiles, onError],
  );

  return { onPaste, onDropCapture, insertFiles, insertAttachments: insertCards };
}
