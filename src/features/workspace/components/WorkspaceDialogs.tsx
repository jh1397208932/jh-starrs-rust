import type { KnowledgeBase, Workspace } from "@/types/notebook";
import { CreateWorkspaceWizard } from "./CreateWorkspaceWizard";
import { KbManageDialog } from "./KbManageDialog";
import { NewKbDialog } from "./NewKbDialog";
import { WsManageDialog } from "./WsManageDialog";

/** 工作区弹窗类型（不含设置/分享：设置归 features/settings，分享归 features/editor） */
export type WorkspaceDialogKind = "createWorkspace" | "newKb" | "kbManage" | "wsManage";

export interface WorkspaceDialogsProps {
  /** 当前打开的工作区弹窗；null = 全部关闭 */
  open: WorkspaceDialogKind | null;
  /** 打开指定弹窗 / 传 null 关闭 */
  onOpenChange: (kind: WorkspaceDialogKind | null) => void;
  workspaces: Workspace[];
  kbs: KnowledgeBase[];
  currentWorkspaceName: string;
  onCreateWorkspace: (name: string) => void;
  onCreateKb: (name: string, description: string) => void;
  onDeleteKb: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  /** 删除当前工作空间被拒时的提示（调用方弹 toast） */
  onDeleteCurrentDenied: () => void;
  onSwitchWorkspace: (id: string) => void;
  onSwitchKb: (id: string) => void;
  onMockAction: (label: string) => void;
}

/**
 * 工作区弹窗群：创建工作空间向导 / 新建知识库 / 知识库管理 / 工作空间管理。
 * 统一收敛 App 组装层的弹窗状态机，内部各自维护受控开合与表单重置。
 */
export function WorkspaceDialogs({
  open,
  onOpenChange,
  workspaces,
  kbs,
  currentWorkspaceName,
  onCreateWorkspace,
  onCreateKb,
  onDeleteKb,
  onDeleteWorkspace,
  onDeleteCurrentDenied,
  onSwitchWorkspace,
  onSwitchKb,
  onMockAction,
}: WorkspaceDialogsProps) {
  return (
    <>
      <CreateWorkspaceWizard
        open={open === "createWorkspace"}
        onOpenChange={(next) => onOpenChange(next ? "createWorkspace" : null)}
        onCreated={onCreateWorkspace}
        onMockAction={onMockAction}
      />
      <NewKbDialog
        open={open === "newKb"}
        onOpenChange={(next) => onOpenChange(next ? "newKb" : null)}
        onCreated={onCreateKb}
      />
      <KbManageDialog
        open={open === "kbManage"}
        onOpenChange={(next) => onOpenChange(next ? "kbManage" : null)}
        workspaceName={currentWorkspaceName}
        kbs={kbs}
        onOpenNewKb={() => onOpenChange("newKb")}
        onSwitchKb={onSwitchKb}
        onDeleteKb={onDeleteKb}
        onMockAction={onMockAction}
      />
      <WsManageDialog
        open={open === "wsManage"}
        onOpenChange={(next) => onOpenChange(next ? "wsManage" : null)}
        workspaces={workspaces}
        onSwitchWorkspace={onSwitchWorkspace}
        onDeleteWorkspace={onDeleteWorkspace}
        onDeleteCurrentDenied={onDeleteCurrentDenied}
      />
    </>
  );
}
