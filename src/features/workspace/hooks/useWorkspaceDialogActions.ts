import { useCallback } from "react";
import type { useToast } from "@/hooks/useToast";
import type { useWorkspaceStore } from "./useWorkspaceStore";

/**
 * 弹窗动作编排：领域变更（store）+ 提示（toast）+ 关窗（setDialog）的 glue 层。
 * 从 App.tsx 抽出的语义单元——store 管状态、本 hook 管编排，两边各自可测。
 */
export function useWorkspaceDialogActions(
  store: ReturnType<typeof useWorkspaceStore>,
  showToast: ReturnType<typeof useToast>["showToast"],
  closeDialog: () => void,
) {
  const createWorkspace = useCallback(
    (name: string) => {
      store.createWorkspace(name);
      closeDialog();
      showToast(`已创建工作空间「${name}」`);
    },
    [store, showToast, closeDialog],
  );

  const createKb = useCallback(
    (name: string, description: string) => {
      store.createKb(name, description);
      showToast(`已创建知识库「${name}」`);
    },
    [store, showToast],
  );

  const deleteKb = useCallback(
    (id: string) => {
      store.deleteKb(id);
      showToast("知识库已删除");
    },
    [store, showToast],
  );

  const deleteWorkspace = useCallback(
    (id: string) => {
      store.deleteWorkspace(id);
      showToast("工作空间已删除");
    },
    [store, showToast],
  );

  const deleteCurrentDenied = useCallback(
    () => showToast("当前工作空间不可删除", "destructive"),
    [showToast],
  );

  return { createWorkspace, createKb, deleteKb, deleteWorkspace, deleteCurrentDenied };
}
