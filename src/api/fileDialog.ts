/**
 * 文件选择/保存对话框封装（tauri-plugin-dialog）。
 * 组件不得直接依赖 @tauri-apps 插件（AGENTS.md §3.3）。
 */

import { open, save } from "@tauri-apps/plugin-dialog";

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
