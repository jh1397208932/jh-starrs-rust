/**
 * 文档块存储 IPC：正文加载与差量保存。
 */

import type { JSONContent } from "@tiptap/core";
import { invokeCommand } from "@/api/client";
import type { DocLoadResult, DocSaveResult } from "@/types/document";

/**
 * 加载文档正文缓存与块树顺序。
 * @param nodeId 文档节点 id
 */
export async function loadDocument(nodeId: string): Promise<DocLoadResult> {
  return invokeCommand<DocLoadResult>("doc_load", { nodeId });
}

/**
 * 保存文档；调用方必须在拿到前端保存互斥锁后再取 `editor.getJSON()`。
 * @param nodeId 文档节点 id
 * @param document Tiptap JSON 根文档
 * @returns add/rm/order/tree 差量与最新字数
 */
export async function saveDocument(nodeId: string, document: JSONContent): Promise<DocSaveResult> {
  return invokeCommand<DocSaveResult>("doc_save", { input: { nodeId, document } });
}
