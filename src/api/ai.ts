/** AI 协作 IPC。 */

import type { AiAuditItem, AiInboxItem, AiInboxStatus, AiPermissions } from "@/types/ai";
import { invokeCommand } from "./client";

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
