/**
 * 原生目录选择（tauri-plugin-dialog）：组件不得直接依赖 @tauri-apps 插件。
 */

import { open } from "@tauri-apps/plugin-dialog";

/** 目录选择参数 */
export interface PickDirectoryParams {
  /** 对话框标题 */
  title: string;
  /** 初始目录（绝对路径，可选） */
  defaultPath?: string;
}

/**
 * 打开系统目录选择器。
 * @param params 标题与可选初始目录
 * @returns 选择结果：确认返回绝对路径，取消返回 null
 * @example const path = await pickDirectory({ title: "选择工作区文件夹" });
 */
export async function pickDirectory(params: PickDirectoryParams): Promise<string | null> {
  const selected = await open({
    title: params.title,
    directory: true,
    multiple: false,
    canCreateDirectories: true,
    defaultPath: params.defaultPath,
  });
  if (selected === null) return null;
  return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}
