/**
 * 文件选择/保存对话框封装（tauri-plugin-dialog）。
 * 组件不得直接依赖 @tauri-apps 插件（AGENTS.md §3.3）。
 */

import { open, save } from "@tauri-apps/plugin-dialog";
import type { BoardExportFormat } from "@/types/board";
import type { ExportFormat } from "@/types/exchange";

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
    title: options.imagesOnly ? "选择图片" : "选择附件",
    filters: options.imagesOnly
      ? [{ name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif"] }]
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
    title: "导出附件",
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
    title: "选择组件库",
    filters: [{ name: "组件库文件", extensions: ["excalidrawlib"] }],
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
 * 选择单文档导出目标路径。
 * @param format 导出格式
 * @param defaultName 默认文件名（不含扩展名）
 * @returns 绝对路径；取消时为 null
 * @example await pickExportPath("markdown", "设计文档");
 */
export async function pickExportPath(format: ExportFormat, defaultName: string): Promise<string | null> {
  const filter = EXPORT_FILTERS[format];
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名文档";
  return save({
    title: `导出为 ${filter.name}`,
    defaultPath: `${safeName}.${filter.extensions[0]}`,
    filters: [filter],
  });
}

/**
 * 选择一批 Markdown / Word / Excalidraw 文件。
 * @returns 绝对路径数组；取消时为空数组
 * @example const paths = await pickImportFiles();
 */
export async function pickImportFiles(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "选择要导入的文件",
    filters: [
      {
        name: "Markdown / Word / Excalidraw",
        extensions: ["md", "markdown", "mdown", "mkd", "docx", "docm", "dotx", "dotm", "doc", "excalidraw"],
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
 * 选择画板导出目标路径。
 * @param format png / svg / excalidraw
 * @param defaultName 默认文件名（不含扩展名）
 * @returns 绝对路径；取消时为 null
 * @example await pickBoardExportPath("png", "架构画板");
 */
export async function pickBoardExportPath(
  format: BoardExportFormat,
  defaultName: string,
): Promise<string | null> {
  const filter = BOARD_EXPORT_FILTERS[format];
  const safeName = defaultName.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名画板";
  return save({
    title: "导出画板",
    defaultPath: `${safeName}.${filter.extensions[0]}`,
    filters: [filter],
  });
}
