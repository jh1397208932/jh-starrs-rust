import { useCallback, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { writeExportFile } from "@/api/exchange";
import { pickBoardExportPath } from "@/api/fileDialog";
import type { BoardExportFormat } from "@/types/board";
import {
  boardFilesToBinary,
  hasBoardFileCards,
  renderBoardPng,
  renderBoardSvg,
  serializeBoardExcalidraw,
  textToBase64,
} from "../utils/exportScene";
import type { BoardCanvasApi } from "./useBoardFileIntake";

interface UseBoardExportOptions {
  api: BoardCanvasApi | null;
  title: string;
  onError: (message: string) => void;
  onExported?: (message: string) => void;
}

export interface BoardExportController {
  exporting: BoardExportFormat | null;
  exportBoard: (format: BoardExportFormat) => Promise<void>;
}

/** 画板单文件导出：PNG / SVG / Excalidraw，保存对话框 + IPC 落盘。 */
export function useBoardExport({
  api,
  title,
  onError,
  onExported,
}: UseBoardExportOptions): BoardExportController {
  const [exporting, setExporting] = useState<BoardExportFormat | null>(null);

  const exportBoard = useCallback(
    async (format: BoardExportFormat) => {
      if (!api) {
        onError("画板尚未加载完成");
        return;
      }
      const target = await pickBoardExportPath(format, title);
      if (!target) return;
      setExporting(format);
      try {
        const elements = api.getSceneElements();
        const appState = api.getAppState() as unknown as Record<string, unknown>;
        const files = boardFilesToBinary(
          Object.values(api.getFiles?.() ?? {}).map((file) => ({
            id: file.id,
            mimeType: file.mimeType,
            dataURL: file.dataURL,
            created: file.created,
          })),
        );
        let dataBase64: string;
        let message: string;
        if (format === "png") {
          dataBase64 = await renderBoardPng(elements, appState, files);
          message = "已导出 PNG 图片";
        } else if (format === "svg") {
          dataBase64 = textToBase64(await renderBoardSvg(elements, appState, files));
          message = "已导出 SVG 矢量图";
        } else {
          dataBase64 = textToBase64(await serializeBoardExcalidraw(elements, appState, files));
          message = hasBoardFileCards(elements)
            ? "已导出；文件附件请用「全部导出」"
            : "已导出 Excalidraw 文件";
        }
        await writeExportFile({ path: target, dataBase64, overwrite: true });
        onExported?.(message);
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        setExporting(null);
      }
    },
    [api, onError, onExported, title],
  );

  return { exporting, exportBoard };
}
