/** AI 协作类型：权限配置、待审区与审计。 */

/** 写权限模式。 */
export type AiPermissionMode = "read-only" | "review" | "editable";

/** 各作用域的写权限。 */
export interface AiPermissions {
  doc: AiPermissionMode;
  board: AiPermissionMode;
  mindmap: AiPermissionMode;
}

/** 待审项状态。 */
export type AiInboxStatus = "pending" | "approved" | "rejected" | "failed";

/** 待审项。 */
export interface AiInboxItem {
  id: string;
  tool: string;
  nodeId: string | null;
  payloadJson: string;
  summary: string;
  risk: "low" | "medium" | "high";
  status: AiInboxStatus;
  error: string | null;
  createdAt: number;
  decidedAt: number | null;
}

/** 审计项。 */
export interface AiAuditItem {
  id: string;
  tool: string;
  nodeId: string | null;
  summary: string;
  risk: "low" | "medium" | "high";
  outcome: "direct" | "inbox" | "approved" | "rejected" | "failed" | "denied";
  createdAt: number;
}

/** 客户端内置 MCP 服务状态。 */
export interface McpStatus {
  /** 设置里的开关 */
  enabled: boolean;
  /** 是否已在本机成功监听 */
  running: boolean;
  /** 运行时的 MCP 端点；未运行为 null */
  url: string | null;
  /** Bearer 令牌（用于配置 agent） */
  token: string;
  /** 启动/运行错误（如端口占用） */
  error: string | null;
}
