import { useCallback, useEffect, useMemo, useState } from "react";
import { uploadAttachmentToTree } from "@/api/attachment";
import { loadBoard } from "@/api/board";
import { toErrorMessage } from "@/api/client";
import { pickDirectory } from "@/api/directory";
import { exportDocument, exportKnowledgeBase, importDocuments, writeExportFile } from "@/api/exchange";
import { pickAttachmentFiles, pickExportPath } from "@/api/fileDialog";
import {
  boardFilesToBinary,
  renderBoardPng,
  renderBoardSvg,
  textToBase64,
} from "@/features/board/utils/exportScene";
import { flushActivePersistence } from "@/features/editor/activeDocument";
import { useShortcutConfig } from "@/features/shortcuts/ShortcutProvider";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { useToast } from "@/hooks/useToast";
import type { ExportFormat, ExportResult, ImportDocumentsParams, ImportResult } from "@/types/exchange";
import type { NodeItem, NodeKind } from "@/types/notebook";
import type { AppDialogState, NodeCreateRequest, WorkspaceDialogKind } from "../types";
import { findNode, getDescendantIds } from "../utils/tree";
import { useTabSession } from "./useTabSession";
import type { WorkspaceDialogActions } from "./useWorkspaceDialogActions";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import type { WorkspaceStore } from "./useWorkspaceStore";

type ShowToast = ReturnType<typeof useToast>["showToast"];

/** 全部导出后补渲染画板 PNG/SVG；单板失败只写警告，不阻断其他画板。 */
async function renderBoardExports(result: ExportResult): Promise<void> {
  for (const board of result.boards) {
    try {
      const data = await loadBoard(board.nodeId);
      if (data.elements.length === 0) {
        result.warnings.push(`画板「${board.title}」为空，已跳过图片导出`);
        continue;
      }
      const files = boardFilesToBinary(data.files);
      const appState = data.appState as unknown as Record<string, unknown>;
      const png = await renderBoardPng(data.elements, appState, files);
      result.files.push(await writeExportFile({ path: board.pngPath, dataBase64: png, overwrite: true }));
      const svg = await renderBoardSvg(data.elements, appState, files);
      result.files.push(
        await writeExportFile({
          path: board.svgPath,
          dataBase64: textToBase64(svg),
          overwrite: true,
        }),
      );
      if (data.missingObjectIds.length > 0) {
        result.warnings.push(`画板「${board.title}」有 ${data.missingObjectIds.length} 个图片或附件缺失`);
      }
    } catch (error) {
      result.warnings.push(`画板「${board.title}」导出失败：${toErrorMessage(error)}`);
    }
  }
}

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
  if (
    !state ||
    state.type === "settings" ||
    state.type === "share" ||
    state.type === "exportKb" ||
    state.type === "import" ||
    state.type === "library"
  ) {
    return null;
  }
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
  const { config: shortcutConfig } = useShortcutConfig();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  // 每次打开/切换文档都从收起状态开始，避免上一页的信息浮窗跟到新文档。
  const activeDocumentId = activeTab?.nodeId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeDocumentId 仅作为“切换文档”触发器
  useEffect(() => {
    setInfoOpen(false);
  }, [activeDocumentId]);
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
    (label: string, kbd?: string) => showToast(`${label} 即将推出`, "primary", kbd),
    [showToast],
  );

  const showError = useCallback((message: string) => showToast(message, "destructive"), [showToast]);

  /** 切换文档/标签/工作区前先落盘；失败则阻止切换并提示重试。 */
  const guardDocumentSave = useCallback(async () => {
    const saved = await flushActivePersistence();
    if (!saved) showToast("文档未保存，请重试", "destructive");
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

  /** 从文件树直接上传附件：逐个创建 type=6 节点，部分失败不影响其余文件。 */
  const uploadAttachmentsToTree = useCallback(
    async (parent: NodeItem | null) => {
      const kb = store.currentKb;
      if (!kb) {
        showToast("请先新建知识库", "destructive");
        return;
      }
      let paths: string[];
      try {
        paths = await pickAttachmentFiles();
      } catch (error) {
        showToast(toErrorMessage(error), "destructive");
        return;
      }
      if (paths.length === 0) return;
      const created: NodeItem[] = [];
      const failures: string[] = [];
      for (const sourcePath of paths) {
        try {
          created.push(
            await uploadAttachmentToTree({
              sourcePath,
              knowledgeBaseId: kb.id,
              parentId: parent?.id ?? null,
            }),
          );
        } catch (error) {
          failures.push(toErrorMessage(error));
        }
      }
      if (created.length > 0) {
        await store.refresh();
        tabSession.openNode(created[0]);
        showToast(
          failures.length > 0
            ? `已上传 ${created.length} 个附件，${failures.length} 个失败`
            : `已上传 ${created.length} 个附件`,
          failures.length > 0 ? "destructive" : "primary",
        );
      } else if (failures.length > 0) {
        showToast(failures[0], "destructive");
      }
    },
    [showToast, store, tabSession],
  );

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
      showToast("请先打开文档", "destructive");
      return;
    }
    void actions.toggleStar(activeNode).catch((error) => showToast(toErrorMessage(error), "destructive"));
  }, [actions, activeNode, showToast]);

  /** 导出当前文档；返回 false 表示用户取消保存路径。 */
  const exportActiveDocument = useCallback(
    async (format: ExportFormat): Promise<boolean> => {
      const nodeId = activeTab?.kind === "doc" ? activeTab.nodeId : null;
      if (!activeTab || !nodeId) {
        throw new Error("请先打开文档");
      }
      if (!(await flushActivePersistence())) {
        throw new Error("文档未保存，请重试");
      }
      const dest = await pickExportPath(format, activeTab.title);
      if (!dest) return false;
      try {
        const result = await exportDocument({ nodeId, format, destPath: dest });
        showToast(
          `已导出 ${result.files.length} 个文件${result.attachmentCount ? `（附件 ${result.attachmentCount} 个）` : ""}`,
          "primary",
        );
        return true;
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    },
    [activeTab, showToast],
  );

  /** 导出当前知识库；返回 false 表示用户取消目录选择。 */
  const exportCurrentKnowledgeBase = useCallback(
    async (format: ExportFormat): Promise<boolean> => {
      const kb = store.currentKb;
      if (!kb) throw new Error("请先选择知识库");
      if (!(await flushActivePersistence())) {
        throw new Error("文档未保存，请重试");
      }
      const destDir = await pickDirectory({ title: "选择导出位置" });
      if (!destDir) return false;
      try {
        const result = await exportKnowledgeBase({
          knowledgeBaseId: kb.id,
          format,
          destDir,
        });
        await renderBoardExports(result);
        const warningSuffix = result.warnings.length > 0 ? `，${result.warnings.length} 个警告` : "";
        showToast(
          `已导出 ${result.files.length} 个文件${result.attachmentCount ? `（附件 ${result.attachmentCount} 个）` : ""}${warningSuffix}`,
          "primary",
        );
        return true;
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    },
    [showToast, store.currentKb],
  );

  /** 执行批量导入并刷新文件树。 */
  const importIntoKnowledgeBase = useCallback(
    async (params: ImportDocumentsParams): Promise<ImportResult> => {
      try {
        if (!(await flushActivePersistence())) {
          throw new Error("文档未保存，请重试");
        }
        const result = await importDocuments(params);
        await store.refresh();
        showToast(
          result.failed > 0
            ? `已导入 ${result.imported} 项，失败 ${result.failed} 项`
            : `已导入 ${result.imported} 项`,
          result.failed > 0 ? "destructive" : "primary",
        );
        return result;
      } catch (error) {
        throw new Error(toErrorMessage(error));
      }
    },
    [showToast, store.refresh],
  );

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

  const appShortcutHandlers = useMemo(
    () => ({
      "app.newNode": createDoc,
      "app.closeTab": closeActiveTab,
      "app.star": toggleStar,
      "app.sidebar": () => setSidebarOpen((value) => !value),
      "app.more": () => setMoreMenuOpen((value) => !value),
      "app.settings": () => onDialogChange({ type: "settings" }),
      "app.quickJump": () => showMockToast("快速跳转"),
      "app.globalSearch": () => showMockToast("全局搜索"),
      "app.save": () => {
        void (async () => {
          if (await guardDocumentSave()) showToast("文档已保存", "primary");
        })();
      },
      "app.presentBoard": () => showMockToast("放映当前画板"),
    }),
    [closeActiveTab, createDoc, guardDocumentSave, onDialogChange, showMockToast, showToast, toggleStar],
  );
  useKeyboardShortcuts(useWorkspaceShortcuts(appShortcutHandlers, shortcutConfig));

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
    uploadAttachmentsToTree,
    handleSwitchWorkspace,
    handleSwitchKb,
    toggleStar,
    exportActiveDocument,
    exportCurrentKnowledgeBase,
    importIntoKnowledgeBase,
    submitNodeCreate,
    submitNodeRename,
    submitNodeDelete,
  };
}

export type WorkspaceMainController = ReturnType<typeof useWorkspaceMainController>;
