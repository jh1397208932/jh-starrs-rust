/**
 * 思维导图导出：Rust 负责行业格式，桌面端负责 SVG/PNG。
 */

import { useCallback, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { writeExportFile } from "@/api/exchange";
import { pickMindmapExportPath } from "@/api/fileDialog";
import { exportMindmap } from "@/api/mindmap";
import { t } from "@/lib/i18n";
import type { MindmapContent, MindmapExportFormat, MindmapFile } from "@/types/mindmap";
import { renderMindmapSvg, svgToPngBlob } from "../utils/exportGraphics";

interface UseMindmapExportOptions {
  nodeId: string;
  title: string;
  content: MindmapContent;
  images: Map<string, MindmapFile>;
  /** 行业格式导出前先把场景落盘（Rust 从库里读最新内容），并复用持久化版本号 */
  flush: () => Promise<boolean>;
  onError: (message: string) => void;
  onExported: (message: string) => void;
}

/** 返回导出命令与忙碌格式。 */
export function useMindmapExport({
  nodeId,
  title,
  content,
  images,
  flush,
  onError,
  onExported,
}: UseMindmapExportOptions) {
  const [exporting, setExporting] = useState<MindmapExportFormat | null>(null);

  const run = useCallback(
    async (format: MindmapExportFormat) => {
      if (exporting) return;
      setExporting(format);
      try {
        const grant = await pickMindmapExportPath(format, title);
        if (!grant) return;
        if (format === "svg" || format === "png") {
          const computed = getComputedStyle(document.documentElement);
          const theme = {
            background: computed.getPropertyValue("--background").trim() || "#fff",
            card: computed.getPropertyValue("--card").trim() || "#fff",
            foreground: computed.getPropertyValue("--foreground").trim() || "#000",
            muted: computed.getPropertyValue("--muted-foreground").trim() || "#666",
            border: computed.getPropertyValue("--border").trim() || "#ddd",
            branches: [0, 1, 2, 3, 4, 5].map(
              (index) => computed.getPropertyValue(`--mindmap-branch-${index}`).trim() || "#888",
            ),
          };
          const svg = renderMindmapSvg(content, title, images, theme);
          const bytes =
            format === "svg"
              ? new TextEncoder().encode(svg)
              : new Uint8Array(await (await svgToPngBlob(svg)).arrayBuffer());
          await writeExportFile({
            token: grant.token,
            path: grant.path,
            dataBase64: uint8ToBase64(bytes),
            overwrite: true,
          });
        } else {
          // 保存交给持久化层：它持有最新版本号，导出不会因为 baseVersion 过期而失败。
          const saved = await flush();
          if (!saved) {
            onError(t("修改尚未保存，导出已取消"));
            return;
          }
          await exportMindmap({ nodeId, format, token: grant.token });
        }
        onExported(t("已导出 {format}", { format: t(MINDMAP_FORMAT_LABELS[format]) }));
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        setExporting(null);
      }
    },
    [content, exporting, flush, images, nodeId, onError, onExported, title],
  );

  return { exporting, exportMindmapFile: run };
}

const MINDMAP_FORMAT_LABELS: Record<MindmapExportFormat, string> = {
  xmind: "XMind 文件",
  freemind: "FreeMind 文件",
  opml: "OPML 大纲",
  markdown: "Markdown",
  native: "Starris 无损文件",
  svg: "SVG 矢量图",
  png: "PNG 图片",
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
