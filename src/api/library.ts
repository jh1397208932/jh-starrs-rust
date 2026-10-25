/**
 * 组件库 IPC 封装。
 */

import { invokeCommand } from "@/api/client";
import type {
  DeleteLibraryResult,
  ImportLibraryParams,
  Library,
  LibraryItem,
  SetLibraryEnabledParams,
} from "@/types/library";

/**
 * 列出组件库（首次调用会补齐内置预设）。
 * @returns 预设与导入库
 * @example const libraries = await listLibraries();
 */
export async function listLibraries(): Promise<Library[]> {
  return invokeCommand<Library[]>("library_list");
}

/**
 * 读取所有启用库的组件，供画板 Library 使用。
 * @returns Excalidraw LibraryItem v2 数组
 * @example const items = await listLibraryItems();
 */
export async function listLibraryItems(): Promise<LibraryItem[]> {
  return invokeCommand<LibraryItem[]>("library_items");
}

/**
 * 导入 `.excalidrawlib`。
 * @param params 文件路径与可选来源元数据
 * @returns 新库
 * @example await importLibrary({ path: "/Users/me/flow.excalidrawlib" });
 */
export async function importLibrary(params: ImportLibraryParams): Promise<Library> {
  return invokeCommand<Library>("library_import", {
    input: {
      path: params.path,
      name: params.name ?? null,
      author: params.author ?? null,
      license: params.license ?? null,
      sourceUrl: params.sourceUrl ?? null,
    },
  });
}

/**
 * 启用/禁用组件库。
 * @param params 库 id 与目标状态
 * @returns 更新后的库
 * @example await setLibraryEnabled({ id, enabled: false });
 */
export async function setLibraryEnabled(params: SetLibraryEnabledParams): Promise<Library> {
  return invokeCommand<Library>("library_set_enabled", { input: params });
}

/**
 * 删除导入库；预设库会被后端拒绝。
 * @param id 库 id
 * @returns 删除的组件数
 * @example await deleteLibrary(id);
 */
export async function deleteLibrary(id: string): Promise<DeleteLibraryResult> {
  return invokeCommand<DeleteLibraryResult>("library_delete", { id });
}
