import { ShareExportDialog } from "@/features/editor/components/ShareExportDialog";
import { SettingsDialog } from "@/features/settings/components/SettingsDialog";
import type { WorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameDialog } from "./NameDialog";
import { NodeCreateDialog } from "./NodeCreateDialog";
import { WorkspaceDialogs } from "./WorkspaceDialogs";

export interface WorkspaceModalsProps {
  controller: WorkspaceMainController;
}

/** 主界面弹窗层：设置、分享、工作区群、节点新建/重命名/删除。 */
export function WorkspaceModals({ controller }: WorkspaceModalsProps) {
  const {
    store,
    actions,
    dialog,
    onDialogChange,
    onPickDirectory,
    activeTab,
    activeNode,
    nodeCreate,
    setNodeCreate,
    nodeRename,
    setNodeRename,
    nodeDelete,
    setNodeDelete,
    nodeDeleteCount,
    workspaceDialogKind,
    submitNodeCreate,
    submitNodeRename,
    submitNodeDelete,
  } = controller;
  const currentWorkspace = store.currentWorkspace;
  if (!currentWorkspace) return null;

  return (
    <>
      <SettingsDialog
        open={dialog?.type === "settings"}
        onOpenChange={(open) => onDialogChange(open ? { type: "settings" } : null)}
        workspacePath={currentWorkspace.path}
      />
      <ShareExportDialog
        open={dialog?.type === "share"}
        onOpenChange={(open) => onDialogChange(open ? { type: "share" } : null)}
        title={activeTab?.title ?? "未命名文档"}
        kbName={store.currentKb?.name ?? ""}
        wordCount={activeNode?.wordCount ?? 0}
        updatedAt={activeNode?.updatedAt ?? Date.now()}
        onMockExport={() => controller.showError("导出功能将在后续阶段实现")}
      />
      <WorkspaceDialogs
        open={workspaceDialogKind}
        onOpenChange={(kind) => onDialogChange(kind ? { type: kind } : null)}
        store={store}
        actions={actions}
        defaultWorkspaceParent={store.defaultWorkspaceParent}
        onPickDirectory={onPickDirectory}
      />

      <NodeCreateDialog
        open={nodeCreate !== null}
        onOpenChange={(open) => {
          if (!open) setNodeCreate(null);
        }}
        parent={nodeCreate?.parent ?? null}
        defaultKind={nodeCreate?.defaultKind}
        initialTitle={nodeCreate?.initialTitle}
        onSubmit={submitNodeCreate}
      />

      <NameDialog
        open={nodeRename !== null}
        onOpenChange={(open) => {
          if (!open) setNodeRename(null);
        }}
        title="重命名"
        description={nodeRename ? `路径：${nodeRename.path}` : undefined}
        label="名称"
        initialValue={nodeRename?.title ?? ""}
        maxLength={200}
        submitLabel="保存"
        onSubmit={submitNodeRename}
      />

      <ConfirmDialog
        open={nodeDelete !== null}
        onOpenChange={(open) => {
          if (!open) setNodeDelete(null);
        }}
        title={`删除「${nodeDelete?.title ?? ""}」？`}
        description={
          nodeDelete?.kind === "folder" && nodeDeleteCount > 0
            ? `该文件夹及其下 ${nodeDeleteCount} 个节点将被永久删除，此操作不可撤销。`
            : "该节点将被永久删除，此操作不可撤销。"
        }
        onConfirm={submitNodeDelete}
      />
    </>
  );
}
