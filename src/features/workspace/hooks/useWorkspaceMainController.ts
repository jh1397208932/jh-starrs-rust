import { useCallback, useEffect, useMemo, useState } from "react";
import { printMainWindow } from "@/api/app";
import { uploadAttachmentToTree } from "@/api/attachment";
import { loadBoard } from "@/api/board";
import { toErrorMessage } from "@/api/client";
import { exportDocument, exportKnowledgeBase, importDocuments, writeExportFile } from "@/api/exchange";
import {
  pickAttachmentFiles,
  pickExportDirectory,
  pickExportPath,
  pickMindmapImportFiles,
} from "@/api/fileDialog";
import { importMindmaps, loadMindmap } from "@/api/mindmap";
import {
  boardFilesToBinary,
  renderBoardPng,
  renderBoardSvg,
  textToBase64,
} from "@/features/board/utils/exportScene";
import { flushActivePersistence } from "@/features/editor/activeDocument";
import { renderMindmapSvg, svgToPngBlob } from "@/features/mindmap/utils/exportGraphics";
import type { SearchMode } from "@/features/search/components/SearchPalette";
import { useShortcutConfig } from "@/features/shortcuts/ShortcutProvider";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import type { useToast } from "@/hooks/useToast";
import { t } from "@/lib/i18n";
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
async function renderBoardExports(result: ExportResult, token: string): Promise<void> {
  for (const board of result.boards) {
    try {
      const data = await loadBoard(board.nodeId);
      if (data.elements.length === 0) {
        result.warnings.push(t("画板「{title}」为空，已跳过图片导出", { title: board.title }));
        continue;
      }
      const files = boardFilesToBinary(data.files);
      const appState = data.appState as unknown as Record<string, unknown>;
      const png = await renderBoardPng(data.elements, appState, files);
      result.files.push(
        await writeExportFile({
          token,
          path: board.pngPath,
          dataBase64: png,
          overwrite: true,
        }),
      );
      const svg = await renderBoardSvg(data.elements, appState, files);
      result.files.push(
        await writeExportFile({
          token,
          path: board.svgPath,
          dataBase64: textToBase64(svg),
          overwrite: true,
        }),
      );
      if (data.missingObjectIds.length > 0) {
        result.warnings.push(
          t("画板「{title}」有 {count} 个图片或附件缺失", {
            title: board.title,
            count: data.missingObjectIds.length,
          }),
        );
      }
    } catch (error) {
      result.warnings.push(
        t("画板「{title}」导出失败：{error}", { title: board.title, error: toErrorMessage(error) }),
      );
    }
  }
}

/** 全部导出后补渲染思维导图 PNG/SVG；单图失败只写警告。 */
async function renderMindmapExports(result: ExportResult, token: string): Promise<void> {
  for (const mindmap of result.mindmaps) {
    try {
      const data = await loadMindmap(mindmap.nodeId);
      const images = new Map(data.images.map((file) => [file.id, file]));
      const style = getComputedStyle(document.documentElement);
      const theme = {
        background: style.getPropertyValue("--background").trim() || "#fff",
        card: style.getPropertyValue("--card").trim() || "#fff",
        foreground: style.getPropertyValue("--foreground").trim() || "#000",
        muted: style.getPropertyValue("--muted-foreground").trim() || "#666",
        border: style.getPropertyValue("--border").trim() || "#ddd",
        branches: [0, 1, 2, 3, 4, 5].map(
          (index) => style.getPropertyValue(`--mindmap-branch-${index}`).trim() || "#888",
        ),
      };
      const svg = renderMindmapSvg(data.content, mindmap.title, images, theme);
      result.files.push(
        await writeExportFile({
          token,
          path: mindmap.svgPath,
          dataBase64: textToBase64(svg),
          overwrite: true,
        }),
      );
      const png = await svgToPngBlob(svg);
      result.files.push(
        await writeExportFile({
          token,
          path: mindmap.pngPath,
          dataBase64: await blobToBase64(png),
          overwrite: true,
        }),
      );
      if (data.missingObjectIds.length > 0) {
        result.warnings.push(
          t("思维导图「{title}」有 {count} 个图片缺失", {
            title: mindmap.title,
            count: data.missingObjectIds.length,
          }),
        );
      }
    } catch (error) {
      result.warnings.push(
        t("思维导图「{title}」导出失败：{error}", {
          title: mindmap.title,
          error: toErrorMessage(error),
        }),
      );
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
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
    state.type === "library" ||
    state.type === "backup" ||
    state.type === "templates" ||
    state.type === "nodeTrash"
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
  // 稳定引用：refresh 之后从 ref 读最新节点，不必把 store.nodes 塞进依赖。
  const nodesRef = store.nodesRef;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  // 每次打开/切换文档都从收起状态开始，避免上一页的信息浮窗跟到新文档。
  const activeDocumentId = activeTab?.nodeId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeDocumentId 仅作为“切换文档”触发器
  useEffect(() => {
    setInfoOpen(false);
  }, [activeDocumentId]);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("search");
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
    (label: string, kbd?: string) => showToast(t("{label} 即将推出", { label }), "primary", kbd),
    [showToast],
  );

  const showError = useCallback((message: string) => showToast(message, "destructive"), [showToast]);

  /** 打开搜索/快速跳转面板；两者共用同一组件与索引。 */
  const openSearch = useCallback((mode: SearchMode) => {
    setSearchMode(mode);
    setSearchOpen(true);
  }, []);

  /** 切换文档/标签/工作区前先落盘；失败则阻止切换并提示重试。 */
  const guardDocumentSave = useCallback(async () => {
    const saved = await flushActivePersistence();
    if (!saved) showToast(t("文档未保存，请重试"), "destructive");
    return saved;
  }, [showToast]);

  const requestNodeCreate = useCallback(
    (parent: NodeItem | null, defaultKind: NodeKind = "doc", initialTitle = "") => {
      if (!store.currentKb) {
        showToast(t("请先新建知识库"), "destructive");
        return;
      }
      setNodeCreate({ parent, defaultKind, initialTitle });
    },
    [showToast, store.currentKb],
  );

  const createDoc = useCallback(() => requestNodeCreate(null), [requestNodeCreate]);
  const createNote = useCallback(() => requestNodeCreate(null, "doc", t("小记")), [requestNodeCreate]);

  /** 从文件树直接上传附件：逐个创建 type=6 节点，部分失败不影响其余文件。 */
  const uploadAttachmentsToTree = useCallback(
    async (parent: NodeItem | null) => {
      const kb = store.currentKb;
      if (!kb) {
        showToast(t("请先新建知识库"), "destructive");
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
            ? t("已上传 {count} 个附件，{failed} 个失败", { count: created.length, failed: failures.length })
            : t("已上传 {count} 个附件", { count: created.length }),
          failures.length > 0 ? "destructive" : "primary",
        );
      } else if (failures.length > 0) {
        showToast(failures[0], "destructive");
      }
    },
    // 依赖收窄到稳定字段：裸 store / tabSession 对象每次渲染都是新引用，
    // 会让 onUploadAttachment 失稳并击穿 Sidebar 的 memo（2026-10-27 性能任务 B2）。
    [showToast, store.currentKb, store.refresh, tabSession.openNode],
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
      showToast(t("请先打开文档"), "destructive");
      return;
    }
    void actions.toggleStar(activeNode).catch((error) => showToast(toErrorMessage(error), "destructive"));
  }, [actions, activeNode, showToast]);

  /** 打印当前文档：先落盘，再打开系统打印面板。 */
  const printActiveDocument = useCallback(async () => {
    if (!(await guardDocumentSave())) return;
    try {
      await printMainWindow();
    } catch (error) {
      showToast(toErrorMessage(error), "destructive");
    }
  }, [guardDocumentSave, showToast]);

  /** 导出当前文档；返回 false 表示用户取消保存路径。 */
  const exportActiveDocument = useCallback(
    async (format: ExportFormat): Promise<boolean> => {
      const nodeId = activeTab?.kind === "doc" || activeTab?.kind === "table" ? activeTab.nodeId : null;
      if (!activeTab || !nodeId) {
        throw new Error(t("请先打开文档"));
      }
      if (!(await flushActivePersistence())) {
        throw new Error(t("文档未保存，请重试"));
      }
      const grant = await pickExportPath(format, activeTab.title);
      if (!grant) return false;
      try {
        const result = await exportDocument({ nodeId, format, token: grant.token });
        showToast(
          t("已导出 {count} 个文件{extra}", {
            count: result.files.length,
            extra: result.attachmentCount ? t("（附件 {count} 个）", { count: result.attachmentCount }) : "",
          }),
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
      if (!kb) throw new Error(t("请先选择知识库"));
      if (!(await flushActivePersistence())) {
        throw new Error(t("文档未保存，请重试"));
      }
      const grant = await pickExportDirectory(t("选择导出位置"));
      if (!grant) return false;
      try {
        const result = await exportKnowledgeBase({
          knowledgeBaseId: kb.id,
          format,
          token: grant.token,
        });
        await renderBoardExports(result, grant.token);
        await renderMindmapExports(result, grant.token);
        const warningSuffix =
          result.warnings.length > 0 ? t("，{count} 个警告", { count: result.warnings.length }) : "";
        showToast(
          t("已导出 {count} 个文件{extra}{warnings}", {
            count: result.files.length,
            extra: result.attachmentCount ? t("（附件 {count} 个）", { count: result.attachmentCount }) : "",
            warnings: warningSuffix,
          }),
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
          throw new Error(t("文档未保存，请重试"));
        }
        const result = await importDocuments(params);
        await store.refresh();
        showToast(
          result.failed > 0
            ? t("已导入 {count} 项，失败 {failed} 项", { count: result.imported, failed: result.failed })
            : t("已导入 {count} 项", { count: result.imported }),
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
      showToast(t("标签已关闭"));
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

  /** 搜索结果只包含当前知识库节点；找不到说明树已过期，刷新后提示。 */
  const openSearchHit = useCallback(
    (nodeId: string) => {
      const node = findNode(store.nodes, nodeId);
      if (!node) {
        showToast(t("内容可能已被删除"), "destructive");
        void store.refresh();
        return;
      }
      openNodeGuarded(node);
    },
    [store.nodes, store.refresh, showToast, openNodeGuarded],
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

  /** 选择并导入思维导图，成功后刷新树并打开第一个节点。 */
  const importMindmapFiles = useCallback(async () => {
    const kb = store.currentKb;
    if (!kb) {
      showError(t("请先新建知识库"));
      return;
    }
    if (!(await flushActivePersistence())) {
      showError(t("文档未保存，请重试"));
      return;
    }
    const paths = await pickMindmapImportFiles();
    if (paths.length === 0) return;
    try {
      const result = await importMindmaps({ knowledgeBaseId: kb.id, parentId: null, paths });
      await store.refresh();
      const first = result.files.find((file) => file.ok && file.nodeId)?.nodeId;
      // refresh 后必须读 ref 里的新节点；闭包里的 store.nodes 还是刷新前的快照。
      const node = first ? findNode(nodesRef.current, first) : null;
      if (node) openNodeGuarded(node);
      showToast(
        result.failed > 0
          ? t("已导入 {count} 项，失败 {failed} 项", { count: result.imported, failed: result.failed })
          : t("已导入 {count} 项", { count: result.imported }),
        result.failed > 0 ? "destructive" : "primary",
      );
    } catch (error) {
      showError(toErrorMessage(error));
    }
  }, [openNodeGuarded, nodesRef, showError, showToast, store.currentKb, store.refresh]);

  /** 新建节点弹窗提交：成功后非文件夹自动打开标签 */
  const submitNodeCreate = useCallback(
    async (kind: NodeKind, title: string) => {
      const kb = store.currentKb;
      if (!kb) throw new Error(t("请先新建知识库"));
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
      "app.quickJump": () => openSearch("quick"),
      "app.globalSearch": () => openSearch("search"),
      "app.presentBoard": () => {
        if (activeTab?.kind !== "board") {
          showToast(t("请先打开画板"), "destructive");
          return;
        }
        window.dispatchEvent(new Event("starris:present-board"));
      },
      "app.save": () => {
        void (async () => {
          if (await guardDocumentSave()) showToast(t("文档已保存"), "primary");
        })();
      },
    }),
    [
      activeTab?.kind,
      closeActiveTab,
      createDoc,
      guardDocumentSave,
      onDialogChange,
      openSearch,
      showToast,
      toggleStar,
    ],
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
    searchOpen,
    setSearchOpen,
    searchMode,
    openSearch,
    openSearchHit,
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
    printActiveDocument,
    exportCurrentKnowledgeBase,
    importIntoKnowledgeBase,
    importMindmapFiles,
    submitNodeCreate,
    submitNodeRename,
    submitNodeDelete,
  };
}

export type WorkspaceMainController = ReturnType<typeof useWorkspaceMainController>;
