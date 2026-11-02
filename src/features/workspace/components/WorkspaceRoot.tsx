import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { pickDirectory } from "@/api/directory";
import { AppToast } from "@/components/common/AppToast";
import { useToast } from "@/hooks/useToast";
import { useI18n } from "@/lib/i18n";
import { useAppCloseGuard } from "../hooks/useAppCloseGuard";
import { useWorkspaceDialogActions } from "../hooks/useWorkspaceDialogActions";
import { useWorkspaceStore } from "../hooks/useWorkspaceStore";
import type { AppDialogState, WorkspaceDialogKind } from "../types";
import { WorkspaceBootScreen } from "./WorkspaceBootScreen";
import { WorkspaceDialogs } from "./WorkspaceDialogs";
import { WorkspaceMain } from "./WorkspaceMain";
import { WorkspaceOnboarding } from "./WorkspaceOnboarding";

/** 应用根：启动门禁（加载/失败/首次引导）与主界面切换。 */
export function WorkspaceRoot() {
  const store = useWorkspaceStore();
  const { t } = useI18n();
  const { toast, showToast } = useToast();
  const [dialog, setDialog] = useState<AppDialogState>(null);
  const actions = useWorkspaceDialogActions(store, showToast);
  useAppCloseGuard(showToast);

  // 删除最后一个工作区后，主界面会卸载；管理类弹窗必须一起关闭，避免覆盖引导页。
  useEffect(() => {
    if (!store.currentWorkspace && dialog && dialog.type !== "createWorkspace") {
      setDialog(null);
    }
  }, [store.currentWorkspace, dialog]);

  /** 选择目录并打开已有工作区；失败抛出给引导页展示 */
  const openExistingWorkspace = useCallback(async () => {
    const path = await pickDirectory({ title: t("打开本地工作区") });
    if (!path) return;
    const workspace = await store.openWorkspace(path);
    showToast(t("已打开工作区「{name}」", { name: workspace.name }), "primary");
  }, [showToast, store.openWorkspace, t]);

  const retry = useCallback(() => {
    void store.refresh().catch(() => undefined);
  }, [store.refresh]);

  /** 工作区创建弹窗的“选择文件夹”适配：统一标题与初始目录 */
  const pickWorkspaceFolder = useCallback(
    (defaultPath?: string) => pickDirectory({ title: t("选择工作区文件夹"), defaultPath }),
    [t],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      await actions.switchWorkspace(id);
    },
    [actions],
  );

  const workspaceDialogKind: WorkspaceDialogKind | null =
    dialog &&
    dialog.type !== "settings" &&
    dialog.type !== "share" &&
    dialog.type !== "exportKb" &&
    dialog.type !== "import" &&
    dialog.type !== "library" &&
    dialog.type !== "backup" &&
    dialog.type !== "templates" &&
    dialog.type !== "nodeTrash"
      ? dialog.type
      : null;

  if (!store.ready || (store.loading && !store.error && !store.currentWorkspace)) {
    return (
      <>
        <WorkspaceBootScreen mode="loading" />
        <AppToast toast={toast} />
      </>
    );
  }

  if (store.error && !store.currentWorkspace) {
    return (
      <>
        <WorkspaceBootScreen mode="error" message={store.error} onRetry={retry} />
        <AppToast toast={toast} />
      </>
    );
  }

  if (!store.currentWorkspace) {
    return (
      <>
        <div className="anim-fade-in h-full bg-background/70" />
        <WorkspaceOnboarding
          workspaces={store.workspaces}
          onCreateWorkspace={() => setDialog({ type: "createWorkspace" })}
          onOpenWorkspace={openExistingWorkspace}
          onSwitchWorkspace={switchWorkspace}
        />
        <WorkspaceDialogs
          open={workspaceDialogKind}
          onOpenChange={(kind) => setDialog(kind ? { type: kind } : null)}
          store={store}
          actions={actions}
          defaultWorkspaceParent={store.defaultWorkspaceParent}
          onPickDirectory={pickWorkspaceFolder}
        />
        <AppToast toast={toast} />
      </>
    );
  }

  return (
    <>
      <WorkspaceMain
        store={store}
        actions={actions}
        showToast={showToast}
        dialog={dialog}
        onDialogChange={setDialog}
        onPickDirectory={pickWorkspaceFolder}
        onOpenExistingWorkspace={() => {
          void openExistingWorkspace().catch((error) => showToast(toErrorMessage(error), "destructive"));
        }}
      />
      <AppToast toast={toast} />
    </>
  );
}
