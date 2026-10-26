/**
 * 崩溃草稿：仅保存在本地 localStorage，用于应用异常退出后恢复最后一次输入。
 * 正常保存成功或用户忽略后清除；不参与 Rust 持久化。
 */

import type { JSONContent } from "@tiptap/core";

const PREFIX = "starris.doc.draft.";

export interface DocumentDraft {
  nodeId: string;
  document: JSONContent;
  savedAt: number;
}

/** 写入草稿；JSON 过大或存储不可用时静默失败。 */
export function saveDraft(nodeId: string, document: JSONContent): void {
  try {
    localStorage.setItem(`${PREFIX}${nodeId}`, JSON.stringify({ nodeId, document, savedAt: Date.now() }));
  } catch {
    // 隐私模式/配额不足时不阻塞编辑。
  }
}

/** 读取草稿；损坏时清除并返回 null。 */
export function readDraft(nodeId: string): DocumentDraft | null {
  const key = `${PREFIX}${nodeId}`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DocumentDraft>;
    if (parsed.nodeId !== nodeId || !parsed.document || typeof parsed.savedAt !== "number") {
      localStorage.removeItem(key);
      return null;
    }
    return { nodeId, document: parsed.document, savedAt: parsed.savedAt };
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/** 清除某文档草稿。 */
export function clearDraft(nodeId: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${nodeId}`);
  } catch {
    // 忽略存储不可用。
  }
}
