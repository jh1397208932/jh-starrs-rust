/** 文档历史类型与 IPC。 */

import { invokeCommand } from "@/api/client";

export interface DocHistorySummary {
  id: string;
  wordCount: number;
  createdAt: number;
}

/** 列出文档历史快照。 */
export async function listDocumentHistory(nodeId: string): Promise<DocHistorySummary[]> {
  return invokeCommand<DocHistorySummary[]>("doc_history_list", { nodeId });
}

/** 把历史快照恢复为当前正文。 */
export async function restoreDocumentHistory(nodeId: string, historyId: string): Promise<void> {
  await invokeCommand("doc_history_restore", { input: { nodeId, historyId } });
}
