/**
 * 组件库前端类型；与 Rust `models/library.rs` 一一对应。
 */

export type LibrarySourceType = "preset" | "import";

export interface Library {
  id: string;
  name: string;
  author: string;
  license: string;
  sourceUrl: string;
  sourceType: LibrarySourceType;
  enabled: boolean;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 与 Excalidraw LibraryItem v2 对齐，可直接喂给 initialData/updateLibrary。 */
export interface LibraryItem {
  id: string;
  name: string;
  status: "published" | "unpublished";
  elements: unknown[];
  created: number;
}

export interface ImportLibraryParams {
  path: string;
  name?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
}

export interface SetLibraryEnabledParams {
  id: string;
  enabled: boolean;
}

export interface DeleteLibraryResult {
  deletedItems: number;
}

/** 组件库启用状态变更事件；画板据此刷新 Library 侧栏。 */
export const LIBRARY_CHANGED_EVENT = "starris:libraries-changed";
