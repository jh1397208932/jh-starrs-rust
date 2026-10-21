import { useCallback, useMemo, useState } from "react";
import { flattenTree } from "@/features/workspace/utils/tree";
import { MOCK_KBS, MOCK_TREE, MOCK_WORKSPACES } from "@/mocks/workspace";
import type { KnowledgeBase, NodeItem, TreeEntry, Workspace } from "@/types/notebook";

/**
 * 工作区领域状态：工作空间 / 知识库 / 文档树及全部变更操作。
 *
 * 本 hook 只管理状态与数据变更，不弹 toast、不碰弹窗开关（由 App 组装层编排）。
 * mock 阶段为本地 state；接入 IPC 后查询改走 @/api/，变更经命令回写。
 */
export function useWorkspaceStore() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(MOCK_WORKSPACES);
  const [kbs, setKbs] = useState<KnowledgeBase[]>(MOCK_KBS);
  const [tree, setTree] = useState<TreeEntry[]>(MOCK_TREE);

  const currentWorkspace = workspaces.find((ws) => ws.isCurrent) ?? workspaces[0];
  const currentKb = kbs.find((kb) => kb.isCurrent) ?? kbs[0];

  /** 收藏节点列表（展平树后过滤，收藏虚拟页使用） */
  const starredNodes = useMemo(() => flattenTree(tree).filter((n) => n.starred), [tree]);

  const switchWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => prev.map((ws) => ({ ...ws, isCurrent: ws.id === id })));
  }, []);

  const switchKb = useCallback((id: string) => {
    setKbs((prev) => prev.map((kb) => ({ ...kb, isCurrent: kb.id === id })));
  }, []);

  const createWorkspace = useCallback((name: string) => {
    setWorkspaces((prev) => [
      ...prev.map((ws) => ({ ...ws, isCurrent: false })),
      {
        id: `ws-${Date.now()}`,
        name,
        path: `~/Starris/${name}`,
        avatarColor: "var(--primary)",
        isCurrent: true,
      },
    ]);
  }, []);

  const createKb = useCallback(
    (name: string, description: string) => {
      setKbs((prev) => [
        ...prev.map((kb) => ({ ...kb, isCurrent: false })),
        {
          id: `kb-${Date.now()}`,
          workspaceId: currentWorkspace?.id ?? "ws-1",
          name,
          description: description || "暂无描述",
          docCount: 0,
          isCurrent: true,
        },
      ]);
    },
    [currentWorkspace],
  );

  const deleteKb = useCallback((id: string) => {
    setKbs((prev) => prev.filter((kb) => kb.id !== id));
  }, []);

  const deleteWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      const next = prev.filter((ws) => ws.id !== id);
      // 删完若无当前空间，把第一个提为当前，保证 currentWorkspace 非空
      if (!next.some((ws) => ws.isCurrent) && next[0]) next[0] = { ...next[0], isCurrent: true };
      return next;
    });
  }, []);

  /**
   * 切换节点收藏态（folder 子项与单层节点均覆盖）。
   * @param nodeId 目标节点 id
   */
  const toggleStar = useCallback((nodeId: string) => {
    setTree((prev) =>
      prev.map((entry) =>
        entry.kind === "folder"
          ? {
              ...entry,
              children: entry.children.map((n) => (n.id === nodeId ? { ...n, starred: !n.starred } : n)),
            }
          : entry.id === nodeId
            ? { ...entry, starred: !entry.starred }
            : entry,
      ),
    );
  }, []);

  /**
   * 在当前知识库下创建文档节点并返回（调用方负责打开标签页）。
   * @param title 文档标题
   * @returns 新建节点（id 形如 node-<时间戳>）
   */
  const createNode = useCallback(
    (title: string): NodeItem => {
      const node: NodeItem = {
        id: `node-${Date.now()}`,
        kbId: currentKb?.id ?? "kb-1",
        title,
        kind: "doc",
        updatedAt: "刚刚",
        wordCount: 0,
        starred: false,
      };
      setTree((prev) => [...prev, node]);
      return node;
    },
    [currentKb],
  );

  return {
    workspaces,
    kbs,
    tree,
    currentWorkspace,
    currentKb,
    starredNodes,
    switchWorkspace,
    switchKb,
    createWorkspace,
    createKb,
    deleteKb,
    deleteWorkspace,
    toggleStar,
    createNode,
  };
}
