import type { WorkspaceDialogActions } from "../hooks/useWorkspaceDialogActions";
import type { WorkspaceStore } from "../hooks/useWorkspaceStore";
import type { WorkspaceDialogKind } from "../types";
import { CreateWorkspaceWizard } from "./CreateWorkspaceWizard";
import { KbEditorDialog } from "./KbEditorDialog";
import { KbManageDialog } from "./KbManageDialog";
import { WsManageDialog } from "./WsManageDialog";

export interface WorkspaceDialogsProps {
  /** 当前打开的工作区弹窗；null = 全部关闭 */
  open: WorkspaceDialogKind | null;
  /** 打开指定弹窗 / 传 null 关闭 */
  onOpenChange: (kind: WorkspaceDialogKind | null) => void;
  store: WorkspaceStore;
  actions: WorkspaceDialogActions;
  defaultWorkspaceParent: string;
  onPickDirectory: (defaultPath?: string) => Promise<string | null>;
}

/**
 * 工作区弹窗群：创建工作区向导 / 新建知识库 / 知识库管理 / 工作区管理。
 * 内部 edit / delete 二级弹窗由各自管理组件持有；这里只收敛一级弹窗状态。
 */
export function WorkspaceDialogs({
  open,
  onOpenChange,
  store,
  actions,
  defaultWorkspaceParent,
  onPickDirectory,
}: WorkspaceDialogsProps) {
  return (
    <>
      <CreateWorkspaceWizard
        open={open === "createWorkspace"}
        onOpenChange={(next) => onOpenChange(next ? "createWorkspace" : null)}
        defaultParent={defaultWorkspaceParent}
        onPickDirectory={onPickDirectory}
        onCreate={async (params) => {
          await actions.createWorkspace(params);
        }}
      />
      <KbEditorDialog
        open={open === "newKb"}
        onOpenChange={(next) => onOpenChange(next ? "newKb" : null)}
        mode="create"
        onSubmit={async (name, description) => {
          await actions.createKb(name, description);
        }}
      />
      <KbManageDialog
        open={open === "kbManage"}
        onOpenChange={(next) => onOpenChange(next ? "kbManage" : null)}
        workspaceName={store.currentWorkspace?.name ?? ""}
        kbs={store.kbs}
        currentKbId={store.currentKb?.id ?? null}
        onOpenNewKb={() => onOpenChange("newKb")}
        onSwitchKb={actions.switchKb}
        onUpdateKb={async (id, params) => {
          await actions.updateKb(id, params);
        }}
        onDeleteKb={async (id) => {
          await actions.deleteKb(id);
        }}
      />
      <WsManageDialog
        open={open === "wsManage"}
        onOpenChange={(next) => onOpenChange(next ? "wsManage" : null)}
        workspaces={store.workspaces}
        currentWorkspaceId={store.currentWorkspace?.id ?? null}
        onSwitch={async (id) => {
          await actions.switchWorkspace(id);
        }}
        onRename={actions.renameWorkspace}
        onDelete={async (id, deleteFolder) => {
          await actions.deleteWorkspace(id, deleteFolder);
        }}
      />
    </>
  );
}
