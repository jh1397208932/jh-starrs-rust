/** AI 协作 IPC。 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiAuditItem, AiInboxItem, AiInboxStatus, AiPermissions } from "@/types/ai";
import { invokeCommand } from "./client";

/** 一条待审写入的前后对比；Rust 侧 `ai_review::AiReviewPreview` 的 camelCase 契约。 */
export interface AiReviewPreview {
  inboxId: string;
  tool: string;
  /** low / medium / high */
  risk: string;
  summary: string;
  /** 受影响内容的可读定位 */
  target: string;
  /** 将被移除或覆盖的行 */
  removed: string[];
  /** 将新增或替换成的行 */
  added: string[];
}

export function getAiPermissions(): Promise<AiPermissions> {
  return invokeCommand<AiPermissions>("ai_permissions_get");
}

export function setAiPermissions(permissions: AiPermissions): Promise<AiPermissions> {
  return invokeCommand<AiPermissions>("ai_permissions_set", { permissions });
}

export function listAiInbox(status?: AiInboxStatus): Promise<AiInboxItem[]> {
  return invokeCommand<AiInboxItem[]>("ai_inbox_list", { status: status ?? null });
}

export function approveAiInbox(id: string): Promise<unknown> {
  return invokeCommand<unknown>("ai_inbox_approve", { id });
}

export function rejectAiInbox(id: string): Promise<void> {
  return invokeCommand<void>("ai_inbox_reject", { id });
}

export function listAiAudit(): Promise<AiAuditItem[]> {
  return invokeCommand<AiAuditItem[]>("ai_audit_list");
}

/** 重新取一条待审项的前后对比（设置页再次打开确认窗时用）。 */
export function getAiReviewPreview(id: string): Promise<AiReviewPreview> {
  return invokeCommand<AiReviewPreview>("ai_review_preview", { id });
}

/**
 * 监听 MCP 写入进入待审区的推送；浏览器 dev 无 Tauri runtime 时返回空清理函数。
 * @param handler 收到一条待审对比后的处理逻辑
 */
export async function onAiReview(handler: (preview: AiReviewPreview) => void): Promise<UnlistenFn> {
  try {
    return await listen<AiReviewPreview>("starris://ai-review", (event) => handler(event.payload));
  } catch {
    return () => undefined;
  }
}
