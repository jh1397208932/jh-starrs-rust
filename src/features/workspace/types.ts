import type { NodeItem, NodeKind } from "@/types/notebook";

/** 工作区群一级弹窗 */
export type WorkspaceDialogKind = "createWorkspace" | "newKb" | "kbManage" | "wsManage";

/** 全局弹窗状态机：同时只开一个（设置 / 分享 / 工作区群） */
export type AppDialogState = null | { type: "settings" } | { type: "share" } | { type: WorkspaceDialogKind };

/** 新建节点弹窗的入参快照 */
export interface NodeCreateRequest {
  parent: NodeItem | null;
  defaultKind: NodeKind;
  initialTitle: string;
}
