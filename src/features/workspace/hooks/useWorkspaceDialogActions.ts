import { useCallback } from "react";
import type { UpdateKnowledgeBaseParams } from "@/api/knowledgeBase";
import type { CreateNodeParams } from "@/api/node";
import type { CreateWorkspaceParams } from "@/api/workspace";
import type { useToast } from "@/hooks/useToast";
import type { DeleteWorkspaceResult, NodeItem } from "@/types/notebook";
import type { WorkspaceStore } from "./useWorkspaceStore";

/** 弹窗与树动作的统一编排：领域写入 + toast；错误继续抛给调用方展示。 */
export function useWorkspaceDialogActions(
  store: WorkspaceStore,
  showToast: ReturnType<typeof useToast>["showToast"],
) {
  const createWorkspace = useCallback(
    async (params: CreateWorkspaceParams) => {
      const workspace = await store.createWorkspace(params);
      showToast(`已创建工作区「${workspace.name}」`, "primary");
      return workspace;
    },
    [store, showToast],
  );

  const switchWorkspace = useCallback(
    async (id: string) => {
      const workspace = await store.switchWorkspace(id);
      showToast(`已切换到「${workspace.name}」`, "primary");
      return workspace;
    },
    [store, showToast],
  );

  const renameWorkspace = useCallback(
    async (id: string, name: string) => {
      await store.renameWorkspace(id, name);
      showToast("工作区已重命名", "primary");
    },
    [store, showToast],
  );

  const deleteWorkspace = useCallback(
    async (id: string, deleteFolder: boolean): Promise<DeleteWorkspaceResult> => {
      const result = await store.deleteWorkspace(id, deleteFolder);
      if (result.warning) showToast(result.warning, "destructive");
      else if (result.folderRemoved) showToast("工作区与本地文件夹已删除");
      else showToast("工作区已从列表移除");
      return result;
    },
    [store, showToast],
  );

  const switchKb = useCallback(
    async (id: string) => {
      const name = store.kbs.find((kb) => kb.id === id)?.name;
      await store.switchKb(id);
      showToast(name ? `已切换到知识库「${name}」` : "已切换知识库", "primary");
    },
    [store, showToast],
  );

  const createKb = useCallback(
    async (name: string, description: string) => {
      const kb = await store.createKb(name, description);
      showToast(`已创建知识库「${kb.name}」`, "primary");
      return kb;
    },
    [store, showToast],
  );

  const updateKb = useCallback(
    async (id: string, params: UpdateKnowledgeBaseParams) => {
      const kb = await store.updateKb(id, params);
      showToast("知识库已更新", "primary");
      return kb;
    },
    [store, showToast],
  );

  const deleteKb = useCallback(
    async (id: string) => {
      const result = await store.deleteKb(id);
      showToast(`知识库已删除（含 ${result.deletedNodes} 个节点）`);
      return result;
    },
    [store, showToast],
  );

  const createNode = useCallback(
    async (params: CreateNodeParams): Promise<NodeItem> => {
      const node = await store.createNode(params);
      showToast(`已创建「${node.title}」`, "primary");
      return node;
    },
    [store, showToast],
  );

  const renameNode = useCallback(
    async (id: string, title: string): Promise<NodeItem> => {
      const node = await store.updateNode(id, { title });
      showToast("已重命名", "primary");
      return node;
    },
    [store, showToast],
  );

  const deleteNode = useCallback(
    async (id: string) => {
      const result = await store.deleteNode(id);
      showToast(`已删除（含 ${result.deletedCount} 个节点）`);
      return result;
    },
    [store, showToast],
  );

  const moveNode = useCallback(
    async (id: string, parentId: string | null, index: number) => {
      await store.moveNode(id, parentId, index);
    },
    [store],
  );

  const toggleStar = useCallback(
    async (node: NodeItem) => {
      const updated = await store.toggleStar(node);
      showToast(updated.starred ? "已收藏" : "已取消收藏", "primary", "⌘D");
      return updated;
    },
    [store, showToast],
  );

  return {
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchKb,
    createKb,
    updateKb,
    deleteKb,
    createNode,
    renameNode,
    deleteNode,
    moveNode,
    toggleStar,
  };
}

export type WorkspaceDialogActions = ReturnType<typeof useWorkspaceDialogActions>;
