import { AiReviewLayer } from "@/features/ai/components/AiReviewLayer";
import { ShareExportDialog } from "@/features/editor/components/ShareExportDialog";
import { SettingsDialog } from "@/features/settings/components/SettingsDialog";
import { useI18n } from "@/lib/i18n";
import type { WorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { BackupDialog } from "./BackupDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExportKnowledgeBaseDialog } from "./ExportKnowledgeBaseDialog";
import { ImportDialog } from "./ImportDialog";
import { NameDialog } from "./NameDialog";
import { NodeCreateDialog } from "./NodeCreateDialog";
import { NodeTrashDialog } from "./NodeTrashDialog";
import { TemplateDialog } from "./TemplateDialog";
import { WorkspaceDialogs } from "./WorkspaceDialogs";

export interface WorkspaceModalsProps {
  controller: WorkspaceMainController;
}

/** 主界面弹窗层：设置、分享、工作区群、节点新建/重命名/删除。 */
export function WorkspaceModals({ controller }: WorkspaceModalsProps) {
  const { t } = useI18n();
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
    exportActiveDocument,
    exportCurrentKnowledgeBase,
    importIntoKnowledgeBase,
    showToast,
    tabSession,
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
      {/* MCP 写入的人工确认：待审项一到就在主界面弹对比窗 */}
      <AiReviewLayer showToast={showToast} workspaceId={currentWorkspace.id} />
      <ShareExportDialog
        open={dialog?.type === "share"}
        onOpenChange={(open) => onDialogChange(open ? { type: "share" } : null)}
        title={activeTab?.title ?? t("未命名文档")}
        kbName={store.currentKb?.name ?? ""}
        wordCount={activeNode?.wordCount ?? 0}
        updatedAt={activeNode?.updatedAt ?? Date.now()}
        onExport={exportActiveDocument}
      />
      <ExportKnowledgeBaseDialog
        open={dialog?.type === "exportKb"}
        onOpenChange={(open) => onDialogChange(open ? { type: "exportKb" } : null)}
        kbName={store.currentKb?.name ?? "知识库"}
        docCount={store.nodes.filter((node) => node.kind !== "folder" && node.kind !== "attachment").length}
        onExport={exportCurrentKnowledgeBase}
      />
      <ImportDialog
        open={dialog?.type === "import"}
        onOpenChange={(open) =>
          onDialogChange(
            open ? { type: "import", parentId: dialog?.type === "import" ? dialog.parentId : null } : null,
          )
        }
        knowledgeBaseId={store.currentKb?.id ?? ""}
        nodes={store.nodes}
        defaultParentId={dialog?.type === "import" ? dialog.parentId : null}
        onImport={importIntoKnowledgeBase}
      />
      <WorkspaceDialogs
        open={workspaceDialogKind}
        onOpenChange={(kind) => onDialogChange(kind ? { type: kind } : null)}
        store={store}
        actions={actions}
        defaultWorkspaceParent={store.defaultWorkspaceParent}
        onPickDirectory={onPickDirectory}
      />
      <BackupDialog
        open={dialog?.type === "backup"}
        onOpenChange={(open) => onDialogChange(open ? { type: "backup" } : null)}
        workspaceName={currentWorkspace.name}
        onRestored={async (workspace) => {
          await store.openWorkspace(workspace.path);
          showToast(t("已恢复「{name}」", { name: workspace.name }), "primary");
        }}
      />
      <TemplateDialog
        open={dialog?.type === "templates"}
        onOpenChange={(open) => onDialogChange(open ? { type: "templates" } : null)}
        currentNode={activeTab?.kind === "doc" || activeTab?.kind === "board" ? activeNode : null}
        knowledgeBaseId={store.currentKb?.id ?? ""}
        onCreated={async (node) => {
          await store.refresh();
          tabSession.openNode(node);
          showToast(t("已从模板创建「{title}」", { title: node.title }), "primary");
        }}
      />

      <NodeTrashDialog
        open={dialog?.type === "nodeTrash"}
        onOpenChange={(open) => onDialogChange(open ? { type: "nodeTrash" } : null)}
        knowledgeBaseId={store.currentKb?.id ?? ""}
        onChanged={() => void store.refresh()}
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
        title={t("重命名")}
        description={nodeRename ? t("路径：{path}", { path: nodeRename.path }) : undefined}
        label={t("名称")}
        initialValue={nodeRename?.title ?? ""}
        maxLength={200}
        submitLabel={t("保存")}
        onSubmit={submitNodeRename}
      />

      <ConfirmDialog
        open={nodeDelete !== null}
        onOpenChange={(open) => {
          if (!open) setNodeDelete(null);
        }}
        title={t("删除「{title}」？", { title: nodeDelete?.title ?? "" })}
        description={
          nodeDelete?.kind === "folder" && nodeDeleteCount > 0
            ? t("文件夹及其中 {count} 项内容将被永久删除，此操作不可撤销。", { count: nodeDeleteCount })
            : t("此内容将被永久删除，此操作不可撤销。")
        }
        onConfirm={submitNodeDelete}
      />
    </>
  );
}
