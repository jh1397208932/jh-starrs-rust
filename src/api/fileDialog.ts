/**
 * 文件选择/保存对话框封装（tauri-plugin-dialog）。
 * 组件不得直接依赖 @tauri-apps 插件（AGENTS.md §3.3）。
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import { invokeCommand } from "@/api/client";
import { t } from "@/lib/i18n";
import type { BoardExportFormat } from "@/types/board";
import type { ExportFormat, ExportPathGrant } from "@/types/exchange";
import type { MindmapExportFormat } from "@/types/mindmap";

/** 文件选择选项 */
export interface PickAttachmentOptions {
  /** 只显示图片过滤 */
  imagesOnly?: boolean;
  /** 是否多选，默认 true */
  multiple?: boolean;
}

/**
 * 选择一个或多个本地文件作为附件。
 * @param options 图片过滤/是否多选
 * @returns 绝对路径数组；用户取消时为空数组
 * @example const paths = await pickAttachmentFiles({ imagesOnly: true });
 */
export async function pickAttachmentFiles(options: PickAttachmentOptions = {}): Promise<string[]> {
  const selected = await open({
    multiple: options.multiple ?? true,
    directory: false,
    title: options.imagesOnly ? t("选择图片") : t("选择附件"),
    filters: options.imagesOnly
      ? [{ name: t("图片"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }]
      : undefined,
  });
  if (selected === null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/**
 * 选择附件导出目标路径。
 * @param defaultName 默认文件名
 * @returns 绝对路径；用户取消时为 null
 * @example const target = await pickAttachmentExportPath("报表.pdf");
 */
export async function pickAttachmentExportPath(defaultName: string): Promise<string | null> {
  return save({
    title: t("导出附件"),
    defaultPath: defaultName,
  });
}

/**
 * 选择一个 `.excalidrawlib` 组件库文件。
 * @returns 绝对路径；取消时返回 null
 * @example const path = await pickLibraryFile();
 */
export async function pickLibraryFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: t("选择组件库"),
    filters: [{ name: t("组件库文件"), extensions: ["excalidrawlib"] }],
  });
  if (selected === null) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/** 导出格式过滤表 */
const EXPORT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  markdown: { name: "Markdown", extensions: ["md"] },
  html: { name: "HTML", extensions: ["html"] },
  docx: { name: "Word", extensions: ["docx"] },
  pdf: { name: "PDF", extensions: ["pdf"] },
};

/**
 * 选择单文档导出目标路径；保存面板由 Rust 打开并签发一次性令牌。
 * @param format 导出格式
 * @param defaultName 默认文件名（不含扩展名）
 * @returns 路径令牌；取消时为 null
 * @example await pickExportPath("markdown", "设计文档");
 */
export async function pickExportPath(
  format: ExportFormat,
  defaultName: string,
): Promise<ExportPathGrant | null> {
  const filter = EXPORT_FILTERS[format];
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || t("未命名文档");
  return invokeCommand<ExportPathGrant | null>("dialog_pick_export_file", {
    suggestedName: `${safeName}.${filter.extensions[0]}`,
    filterName: t(filter.name),
    extensions: filter.extensions,
  });
}

/**
 * 选择整库导出目录；目录令牌只允许写入该目录及其后代。
 * @param title 面板标题
 * @returns 目录令牌；取消时为 null
 * @example const grant = await pickExportDirectory("选择导出位置");
 */
export async function pickExportDirectory(title: string): Promise<ExportPathGrant | null> {
  return invokeCommand<ExportPathGrant | null>("dialog_pick_export_dir", { title });
}

/**
 * 选择一批 Markdown / Word / PDF / Excalidraw 文件。
 * @returns 绝对路径数组；取消时为空数组
 * @example const paths = await pickImportFiles();
 */
export async function pickImportFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: t("选择要导入的文件"),
    filters: [
      {
        name: t("支持的文件"),
        extensions: [
          "md",
          "markdown",
          "mdown",
          "mkd",
          "docx",
          "docm",
          "dotx",
          "dotm",
          "doc",
          "pdf",
          "excalidraw",
          "xmind",
          "mm",
          "opml",
          "json",
        ],
      },
    ],
  });
  if (selected === null) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** 画板导出格式过滤表 */
const BOARD_EXPORT_FILTERS: Record<BoardExportFormat, { name: string; extensions: string[] }> = {
  png: { name: "PNG 图片", extensions: ["png"] },
  svg: { name: "SVG 矢量图", extensions: ["svg"] },
  excalidraw: { name: "Excalidraw 文件", extensions: ["excalidraw"] },
};

/**
 * 选择画板导出目标路径；保存面板由 Rust 打开并签发一次性令牌。
 * @param format png / svg / excalidraw
 * @param defaultName 默认文件名（不含扩展名）
 * @returns 路径令牌；取消时为 null
 * @example await pickBoardExportPath("png", "架构画板");
 */
export async function pickBoardExportPath(
  format: BoardExportFormat,
  defaultName: string,
): Promise<ExportPathGrant | null> {
  const filter = BOARD_EXPORT_FILTERS[format];
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || t("未命名画板");
  return invokeCommand<ExportPathGrant | null>("dialog_pick_export_file", {
    suggestedName: `${safeName}.${filter.extensions[0]}`,
    filterName: t(filter.name),
    extensions: filter.extensions,
  });
}

/** 思维导图导出格式过滤表 */
const MINDMAP_EXPORT_FILTERS: Record<MindmapExportFormat, { name: string; extensions: string[] }> = {
  xmind: { name: "XMind 文件", extensions: ["xmind"] },
  freemind: { name: "FreeMind 文件", extensions: ["mm"] },
  opml: { name: "OPML 大纲", extensions: ["opml"] },
  markdown: { name: "Markdown", extensions: ["md"] },
  native: { name: "Starris 思维导图", extensions: ["json"] },
  svg: { name: "SVG 矢量图", extensions: ["svg"] },
  png: { name: "PNG 图片", extensions: ["png"] },
};

/**
 * 选择思维导图导出目标路径；保存面板由 Rust 打开并签发一次性令牌。
 * @param format 思维导图导出格式
 * @param defaultName 默认文件名（不含扩展名）
 * @returns 路径令牌；取消时为 null
 * @example await pickMindmapExportPath("xmind", "产品规划")
 */
export async function pickMindmapExportPath(
  format: MindmapExportFormat,
  defaultName: string,
): Promise<ExportPathGrant | null> {
  const filter = MINDMAP_EXPORT_FILTERS[format];
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || t("未命名思维导图");
  const extension = format === "native" ? "starris-mindmap.json" : filter.extensions[0];
  return invokeCommand<ExportPathGrant | null>("dialog_pick_export_file", {
    suggestedName: `${safeName}.${extension}`,
    filterName: t(filter.name),
    extensions: format === "native" ? ["json"] : filter.extensions,
  });
}
