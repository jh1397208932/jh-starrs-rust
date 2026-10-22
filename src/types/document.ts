/**
 * 文档块存储 IPC 契约，与 Rust `models/document.rs` 一一对应。
 */

import type { JSONContent } from "@tiptap/core";

/** 新增块（工作区 hash 表中原本不存在的块） */
export interface BlockAdd {
  hash: string;
  json: JSONContent;
}

/** 一段连续重排；after/before 为空表示头部/尾部 */
export interface BlockOrderChange {
  after: string;
  before: string;
  hashList: string[];
}

/** 保存后的块实例（按 order 升序） */
export interface BlockNode {
  id: string;
  hash: string;
  order: string;
}

/** 文档保存差量 */
export interface DocSaveResult {
  add: BlockAdd[];
  rm: string[];
  order: BlockOrderChange[];
  tree: BlockNode[];
  wordCount: number;
  updatedAt: number;
}

/** 文档加载结果 */
export interface DocLoadResult {
  document: JSONContent;
  wordCount: number;
  updatedAt: number;
  tree: BlockNode[];
  /** 后端是否修复了历史脏数据（前端需自动补一次保存） */
  normalized: boolean;
}
