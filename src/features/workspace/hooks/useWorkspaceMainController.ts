import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { flushActiveDocument } from "@/features/editor/activeDocument";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { useToast } from "@/hooks/useToast";
import type { NodeItem, NodeKind } from "@/types/notebook";
import type { AppDialogState, NodeCreateRequest, WorkspaceDialogKind } from "../types";
import { findNode, getDescendantIds } from "../utils/tree";
import { useTabSession } from "./useTabSession";
import type { WorkspaceDialogActions } from "./useWorkspaceDialogActions";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import type { WorkspaceStore } from "./useWorkspaceStore";

type ShowToast = ReturnType<typeof useToast>["showToast"];

export interface WorkspaceMainControllerOptions {
  store: WorkspaceStore;
  actions: WorkspaceDialogActions;
  showToast: ShowToast;
  dialog: AppDialogState;
  onDialogChange: (state: AppDialogState) => void;
  onPickDirectory: (defaultPath?: string) => Promise<string | null>;
  /** 选择目录并打开已有工作区（错误已由上层 toast） */
  onOpenExistingWorkspace: () => void;
}

/** 工作区弹窗 kind 收窄：从全局 dialog 状态中取出工作区群弹窗 */
function toWorkspaceDialogKind(state: AppDialogState): WorkspaceDialogKind | null {
  if (!state || state.type === "settings" || state.type === "share") return null;
  return state.type;
}

/**
 * 主界面控制器：聚合标签会话、UI 状态、节点弹窗、快捷键与会话切换副作用。
 * WorkspaceMain 只做布局组装；本 hook 不直接调用 IPC，写操作全部经 store/actions。
 */
export function useWorkspaceMainController({
  store,
  actions,
  showToast,
  dialog,
  onDialogChange,
  onPickDirectory,
  onOpenExistingWorkspace,
}: WorkspaceMainControllerOptions) {
  const tabSession = useTabSession();
  const { activeTab, openNode } = tabSession;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(() => window.innerWidth >= 1280);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [nodeCreate, setNodeCreate] = useState<NodeCreateRequest | null>(null);
  const [nodeRename, setNodeRename] = useState<NodeItem | null>(null);
  const [nodeDelete, setNodeDelete] = useState<NodeItem | null>(null);

  const activeNode = activeTab?.nodeId ? findNode(store.nodes, activeTab.nodeId) : null;
  const activeKbName = activeTab?.kind === "starred" ? null : (store.currentKb?.name ?? null);
  const infoVisible = infoOpen && activeTab?.kind === "doc";
  const nodeDeleteCount = nodeDelete ? getDescendantIds(store.nodes, nodeDelete.id).size : 0;
  const workspaceDialogKind = toWorkspaceDialogKind(dialog);
  const workspaceId = store.currentWorkspace?.id;
  const kbId = store.currentKb?.id;

  // 切换工作区/知识库即清空标签，避免跨库 nodeId 残留。
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspaceId/kbId 只作为“会话切换”触发器，用于清空标签
  useEffect(() => {
    tabSession.resetTabs();
  }, [workspaceId, kbId, tabSession.resetTabs]);

  // 树变化时同步标签标题并剔除已删除节点。
  useEffect(() => {
    tabSession.syncTabs(store.nodes);
  }, [store.nodes, tabSession.syncTabs]);

  const showMockToast = useCallback(
    (label: string, kbd?: string) =>
      showToast(`已触发 ${kbd ? `${kbd} ` : ""}${label}（mock）`, "primary", kbd),
    [showToast],
  );

  const showError = useCallback((message: string) => showToast(message, "destructive"), [showToast]);

  /** 切换文档/标签/工作区前先落盘；失败则阻止切换并提示重试。 */
  const guardDocumentSave = useCallback(async () => {
    const saved = await flushActiveDocument();
    if (!saved) showToast("文档尚未保存成功，请重试后再切换", "destructive");
    return saved;
  }, [showToast]);

  const requestNodeCreate = useCallback(
    (parent: NodeItem | null, defaultKind: NodeKind = "doc", initialTitle = "") => {
      if (!store.currentKb) {
        showToast("请先新建知识库", "destructive");
        return;
      }
      setNodeCreate({ parent, defaultKind, initialTitle });
    },
    [showToast, store.currentKb],
  );

  const createDoc = useCallback(() => requestNodeCreate(null), [requestNodeCreate]);
  const createNote = useCallback(() => requestNodeCreate(null, "doc", "小记"), [requestNodeCreate]);

  const handleSwitchWorkspace = useCallback(
    (id: string) => {
      void (async () => {
        if (!(await guardDocumentSave())) return;
        try {
          await actions.switchWorkspace(id);
        } catch (error) {
          showToast(toErrorMessage(error), "destructive");
        }
      })();
    },
    [actions, guardDocumentSave, showToast],
  );

  const handleSwitchKb = useCallback(
    (id: string) => {
      void (async () => {
        if (!(await guardDocumentSave())) return;
        try {
          await actions.switchKb(id);
        } catch (error) {
          showToast(toErrorMessage(error), "destructive");
        }
      })();
    },
    [actions, guardDocumentSave, showToast],
  );

  const toggleStar = useCallback(() => {
    if (!activeNode) {
      showToast("请先打开一个节点", "destructive");
      return;
    }
    void actions.toggleStar(activeNode).catch((error) => showToast(toErrorMessage(error), "destructive"));
  }, [actions, activeNode, showToast]);

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return;
    void (async () => {
      if (!(await guardDocumentSave())) return;
      tabSession.closeTab(activeTab.id);
      showToast("标签已关闭");
    })();
  }, [activeTab, guardDocumentSave, showToast, tabSession.closeTab]);

  const openNodeGuarded = useCallback(
    (node: NodeItem) => {
      if (activeTab?.nodeId === node.id) return;
      void (async () => {
        if (!(await guardDocumentSave())) return;
        tabSession.openNode(node);
      })();
    },
    [activeTab?.nodeId, guardDocumentSave, tabSession.openNode],
  );

  const setActiveTabIdGuarded = useCallback(
    (id: string) => {
      if (id === tabSession.activeTabId) return;
      void (async () => {
        if (!(await guardDocumentSave())) return;
        tabSession.setActiveTabId(id);
      })();
    },
    [guardDocumentSave, tabSession.activeTabId, tabSession.setActiveTabId],
  );

  const closeTabGuarded = useCallback(
    (id: string) => {
      if (id !== tabSession.activeTabId) {
        tabSession.closeTab(id);
        return;
      }
      void (async () => {
        if (!(await guardDocumentSave())) return;
        tabSession.closeTab(id);
      })();
    },
    [guardDocumentSave, tabSession.activeTabId, tabSession.closeTab],
  );

  const showStarredGuarded = useCallback(() => {
    if (activeTab?.kind === "starred") return;
    void (async () => {
      if (!(await guardDocumentSave())) return;
      tabSession.showStarred();
    })();
  }, [activeTab?.kind, guardDocumentSave, tabSession.showStarred]);

  const guardedTabSession = {
    ...tabSession,
    openNode: openNodeGuarded,
    closeTab: closeTabGuarded,
    showStarred: showStarredGuarded,
    setActiveTabId: setActiveTabIdGuarded,
  };

  /** 新建节点弹窗提交：成功后非文件夹自动打开标签 */
  const submitNodeCreate = useCallback(
    async (kind: NodeKind, title: string) => {
      const kb = store.currentKb;
      if (!kb) throw new Error("请先新建知识库");
      const node = await actions.createNode({
        knowledgeBaseId: kb.id,
        parentId: nodeCreate?.parent?.id ?? null,
        kind,
        title,
      });
      if (node.kind !== "folder") openNode(node);
    },
    [actions, nodeCreate, openNode, store.currentKb],
  );

  const submitNodeRename = useCallback(
    async (value: string) => {
      if (nodeRename) await actions.renameNode(nodeRename.id, value);
    },
    [actions, nodeRename],
  );

  const submitNodeDelete = useCallback(async () => {
    if (nodeDelete) await actions.deleteNode(nodeDelete.id);
  }, [actions, nodeDelete]);

  useKeyboardShortcuts(
    useWorkspaceShortcuts({
      createDoc,
      closeActiveTab,
      toggleStar,
      toggleSidebar: () => setSidebarOpen((value) => !value),
      toggleMoreMenu: () => setMoreMenuOpen((value) => !value),
      openSettings: () => onDialogChange({ type: "settings" }),
      quickJump: () => showMockToast("快速跳转", "⌘K"),
      globalSearch: () => showMockToast("全局搜索", "⌘⇧F"),
      saveDoc: () => {
        void (async () => {
          if (await guardDocumentSave()) showToast("文档已保存", "primary");
        })();
      },
      presentBoard: () => showMockToast("放映当前画板", "⌘P"),
    }),
  );

  return {
    store,
    actions,
    tabSession: guardedTabSession,
    activeTab,
    activeNode,
    activeKbName,
    infoVisible,
    infoOpen,
    setInfoOpen,
    sidebarOpen,
    setSidebarOpen,
    moreMenuOpen,
    setMoreMenuOpen,
    nodeCreate,
    setNodeCreate,
    nodeRename,
    setNodeRename,
    nodeDelete,
    setNodeDelete,
    nodeDeleteCount,
    dialog,
    onDialogChange,
    onPickDirectory,
    onOpenExistingWorkspace,
    workspaceDialogKind,
    showToast,
    showError,
    showMockToast,
    requestNodeCreate,
    createDoc,
    createNote,
    handleSwitchWorkspace,
    handleSwitchKb,
    toggleStar,
    submitNodeCreate,
    submitNodeRename,
    submitNodeDelete,
  };
}

export type WorkspaceMainController = ReturnType<typeof useWorkspaceMainController>;
