import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import "../board.css";
import { Layers } from "lucide-react";
import { uploadAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { listLibraryItems } from "@/api/library";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { registerActivePersistence, unregisterActivePersistence } from "@/features/editor/activeDocument";
import { scheduleNodePreview } from "@/features/editor/utils/nodePreview";
import { isEditableTarget } from "@/features/shortcuts/shortcutKeys";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { BoardCanvasApi } from "@/types/board";
import { LIBRARY_CHANGED_EVENT, type LibraryItem } from "@/types/library";
import { useBoardExport } from "../hooks/useBoardExport";
import { type BoardShortcutHandlers, useBoardKeymap } from "../hooks/useBoardKeymap";
import { type BoardLibraryEntry, useBoardLibraryEntries } from "../hooks/useBoardLibrary";
import { useBoardLibraryInsertion } from "../hooks/useBoardLibraryInsertion";
import { useBoardPersistence } from "../hooks/useBoardPersistence";
import { BoardHelpDialog } from "./BoardHelpDialog";
import { BoardLibraryPanel } from "./BoardLibraryPanel";
import { BoardPageBar } from "./BoardPageBar";

/** Excalidraw 体积较大，按需加载，不阻塞工作区首屏。 */
const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({ default: module.Excalidraw })),
);

/** Excalidraw 的 initialData 类型随包导出较深；这里只借用组件 Props 的字段类型。 */
type ExcalidrawInitialData = NonNullable<React.ComponentProps<typeof Excalidraw>["initialData"]>;

export interface BoardViewProps {
  /** 画板节点 id */
  nodeId: string;
  /** 画板标题（页头与标签一致） */
  title: string;
  /** 所在知识库名；为空隐藏首段面包屑 */
  kbName: string | null;
  /** 保存成功后同步文件树编辑时间 */
  onSaved: (updatedAt: number) => void;
  /** 错误提示 */
  onError: (message: string) => void;
  /** 点击面包屑中的知识库 */
  onOpenKb: () => void;
  /** 导出成功提示 */
  onExported?: (message: string) => void;
}

const BOARD_UI_OPTIONS = {
  canvasActions: {
    toggleTheme: false,
  },
} as const;

function BoardFallback({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <span aria-hidden="true" className="text-[34px] leading-none opacity-40">
        ✦
      </span>
      <p className={`${CAPTION_CLS} text-muted-foreground`}>{message ?? t("画板加载中…")}</p>
    </div>
  );
}

/**
 * 画板视图：Excalidraw 画布 + 自动保存 + 全局对象图片。
 * 图片粘贴由 `generateIdForFile` 先上传到全局对象库，fileId 即 object_id；
 */
/**
 * 组件库列表的模块级缓存。
 *
 * 库里是 200+ 条组件、每条带完整图元 JSON；以前每打开一个画板标签页都重新 IPC 拉取并解析一遍，
 * 同一进程里切来切去纯属重复劳动。库内容只在导入/启停时变化，用 LIBRARY_CHANGED_EVENT 失效即可。
 */
let libraryItemsCache: LibraryItem[] | null = null;
/** 缓存是否已过期；库导入/启停事件在任意页面都可能发生，用模块级标记而不是组件内状态。 */
let libraryItemsCacheStale = true;
if (typeof window !== "undefined") {
  window.addEventListener(LIBRARY_CHANGED_EVENT, () => {
    libraryItemsCacheStale = true;
  });
}

function BoardViewImpl({ nodeId, title, kbName, onSaved, onError, onOpenKb, onExported }: BoardViewProps) {
  const { locale, t } = useI18n();
  const { mode } = useTheme();
  const [api, setApi] = useState<BoardCanvasApi | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[] | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [background, setBackground] = useState("#ffffff");
  const backgroundRef = useRef("#ffffff");
  const [presenting, setPresenting] = useState(false);
  const lastErrorRef = useRef("");
  const showError = useCallback(
    (message: string) => {
      if (lastErrorRef.current === message) return;
      lastErrorRef.current = message;
      onError(message);
    },
    [onError],
  );

  const persistence = useBoardPersistence({ nodeId, onSaved, onError: showError });
  const boardExport = useBoardExport({ api, title, onError: showError, onExported });
  const { entries: libraryEntries, loading: libraryLoading } = useBoardLibraryEntries(libraryItems);
  // 稳定引用：这两处内联回调每次渲染都换身份，会让 memo 化的组件卡片全部重渲染。
  const closeLibrary = useCallback(() => setLibraryOpen(false), []);
  const {
    insertingKey,
    dropActive,
    dragGhost,
    insertFromLibrary,
    handlePointerDown: handleLibraryPointerDown,
  } = useBoardLibraryInsertion(api, showError);
  const insertLibraryEntry = useCallback(
    (entry: BoardLibraryEntry) => void insertFromLibrary(entry),
    [insertFromLibrary],
  );
  const boardShortcutHandlers = useMemo<BoardShortcutHandlers>(
    () => ({
      "board.openLibrary": () => setLibraryOpen((current) => !current),
      "board.exportPng": () => void boardExport.exportBoard("png"),
      "board.save": () => void persistence.flush(),
      "board.select": () => api?.setActiveTool?.({ type: "selection" }),
      "board.rectangle": () => api?.setActiveTool?.({ type: "rectangle" }),
      "board.ellipse": () => api?.setActiveTool?.({ type: "ellipse" }),
      "board.arrow": () => api?.setActiveTool?.({ type: "arrow" }),
      "board.text": () => api?.setActiveTool?.({ type: "text" }),
    }),
    [api, boardExport, persistence.flush],
  );
  useBoardKeymap(boardShortcutHandlers);

  // Excalidraw 的 ? 仍会打开原生帮助；拦下来统一进自家帮助弹窗。
  useEffect(() => {
    const handleHelpKey = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      setHelpOpen(true);
    };
    window.addEventListener("keydown", handleHelpKey, true);
    return () => window.removeEventListener("keydown", handleHelpKey, true);
  }, []);

  const togglePresentation = useCallback(async () => {
    setPresenting((current) => {
      const next = !current;
      void (async () => {
        try {
          if (next) await document.documentElement.requestFullscreen?.();
          else if (document.fullscreenElement) await document.exitFullscreen();
        } catch {
          // 全屏 API 不可用时仍保留固定层放映。
        }
      })();
      return next;
    });
  }, []);

  useEffect(() => {
    const handlePresent = () => void togglePresentation();
    window.addEventListener("starris:present-board", handlePresent);
    return () => window.removeEventListener("starris:present-board", handlePresent);
  }, [togglePresentation]);

  useEffect(() => {
    if (!presenting) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void togglePresentation();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [presenting, togglePresentation]);

  // 浏览器全屏被 Esc 原生退出时，同步撤掉固定层，避免只剩半截放映状态。
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (libraryItemsCache && !libraryItemsCacheStale) setLibraryItems(libraryItemsCache);
    const loadLibraries = () => {
      void listLibraryItems()
        .then((items) => {
          libraryItemsCache = items;
          libraryItemsCacheStale = false;
          if (!cancelled) setLibraryItems(items);
        })
        .catch(() => {
          if (!cancelled) setLibraryItems([]);
        });
    };
    if (!libraryItemsCache || libraryItemsCacheStale) loadLibraries();
    window.addEventListener(LIBRARY_CHANGED_EVENT, loadLibraries);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_CHANGED_EVENT, loadLibraries);
    };
  }, []);

  useEffect(() => {
    if (persistence.status === "saved") lastErrorRef.current = "";
  }, [persistence.status]);

  // 保存静止后导出文档内嵌预览；文档端只读已存 PNG，不触发渲染。
  useEffect(() => {
    if (persistence.status !== "saved") return;
    scheduleNodePreview("board", nodeId);
  }, [persistence.status, nodeId]);

  useEffect(() => {
    if (persistence.missingObjectIds.length === 0) return;
    showError(t("有 {count} 个图片缺失", { count: persistence.missingObjectIds.length }));
  }, [persistence.missingObjectIds, showError, t]);

  useEffect(() => {
    const owner = Symbol("board-persistence");
    registerActivePersistence(owner, persistence.flush);
    return () => unregisterActivePersistence(owner);
  }, [persistence.flush]);

  // 画布背景由页头「⋯」修改；onChange 会把它带回保存链路。
  useEffect(() => {
    const value = persistence.initialData?.appState.viewBackgroundColor;
    if (typeof value === "string" && value) {
      backgroundRef.current = value;
      setBackground(value);
    }
  }, [persistence.initialData]);

  const changeBackground = useCallback(
    (color: string) => {
      backgroundRef.current = color;
      setBackground(color);
      if (!api) return;
      api.updateScene({ appState: { viewBackgroundColor: color } });
      // 背景属于可导出的 appState；显式交给保存器，保证“只改背景”也会落库。
      persistence.onSceneChange(api.getSceneElements(), {
        ...api.getAppState(),
        viewBackgroundColor: color,
      });
    },
    [api, persistence.onSceneChange],
  );

  const resetCanvas = useCallback(() => {
    api?.updateScene({ elements: [] });
    setResetOpen(false);
  }, [api]);

  /** 原生「打开文件/画布内查找」没有公开 API，转发快捷键到画布容器。 */
  const dispatchCanvasShortcut = useCallback((key: string, code: string) => {
    const container = document.querySelector<HTMLElement>(".board-excalidraw .excalidraw");
    if (!container) return;
    container.focus({ preventScroll: true });
    const isMac = navigator.userAgent.includes("Macintosh");
    container.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        metaKey: isMac,
        ctrlKey: !isMac,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, []);

  const handleSceneChange = useCallback(
    (elements: readonly unknown[], nextAppState: Record<string, unknown>) => {
      persistence.onSceneChange(elements, nextAppState);
      const color = nextAppState.viewBackgroundColor;
      if (typeof color === "string" && color !== backgroundRef.current) {
        backgroundRef.current = color;
        setBackground(color);
      }
    },
    [persistence.onSceneChange],
  );

  // Excalidraw 对回调引用敏感：这些箭头函数每次渲染都换身份，保存状态一变就会让整个画布重渲染。
  const handleExcalidrawApi = useCallback((nextApi: unknown) => {
    setApi(nextApi as BoardCanvasApi);
  }, []);
  const handleExcalidrawChange = useCallback(
    (elements: readonly unknown[], appState: unknown) =>
      handleSceneChange(elements, appState as Record<string, unknown>),
    [handleSceneChange],
  );
  const handleScroll = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) =>
      persistence.onScrollChange(scrollX, scrollY, zoom.value),
    [persistence.onScrollChange],
  );
  const handleCanvasPointerDown = useCallback(() => persistence.onPointerDown(), [persistence.onPointerDown]);
  const handleCanvasPointerUp = useCallback(() => persistence.onPointerUp(), [persistence.onPointerUp]);

  /** 图片文件先进入全局对象库，返回 object_id 作为 Excalidraw fileId。 */
  const generateIdForFile = useCallback(
    async (file: File) => {
      try {
        const attachment = await uploadAttachmentBytes(file, `画板/${nodeId}`);
        return attachment.id;
      } catch (error) {
        const message = toErrorMessage(error);
        showError(message);
        throw error;
      }
    },
    [nodeId, showError],
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        presenting ? "anim-fade-in fixed inset-0 z-50 bg-background" : "h-full",
      )}
    >
      {!presenting && (
        <BoardPageBar
          kbName={kbName}
          title={title}
          status={persistence.status}
          onRetry={persistence.retry}
          onReload={persistence.reload}
          onOpenKb={onOpenKb}
          onExport={(format) => void boardExport.exportBoard(format)}
          onPresent={() => void togglePresentation()}
          background={background}
          onBackgroundChange={changeBackground}
          onOpenHelp={() => setHelpOpen(true)}
          onResetCanvas={() => setResetOpen(true)}
          onOpenFile={() => dispatchCanvasShortcut("o", "KeyO")}
          onFindInCanvas={() => dispatchCanvasShortcut("f", "KeyF")}
          exporting={boardExport.exporting}
        />
      )}
      {presenting && (
        <button
          type="button"
          onClick={() => void togglePresentation()}
          className="absolute top-3 right-3 z-10 rounded-full border border-border/60 bg-card/90 px-3 py-1.5 text-[12px] text-muted-foreground shadow-sm hover:text-foreground"
        >
          {t("退出放映 (Esc)")}
        </button>
      )}
      <div className="flex min-h-0 flex-1">
        <fieldset
          className="board-excalidraw relative m-0 min-h-0 min-w-0 flex-1 border-0 p-0"
          aria-label={t("画布")}
        >
          {persistence.loadError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[13px] text-destructive">{persistence.loadError}</p>
              <button
                type="button"
                onClick={persistence.reload}
                className="rounded-[8px] border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground transition-[background-color,border-color,scale] duration-150 ease-[var(--ease)] hover:bg-accent active:scale-[0.97]"
              >
                {t("重新加载")}
              </button>
            </div>
          ) : persistence.initialData ? (
            <Suspense fallback={<BoardFallback />}>
              <Excalidraw
                key={nodeId}
                langCode={locale === "en-US" ? "en" : "zh-CN"}
                theme={mode}
                zenModeEnabled={presenting}
                initialData={persistence.initialData as unknown as ExcalidrawInitialData}
                UIOptions={BOARD_UI_OPTIONS}
                generateIdForFile={generateIdForFile}
                excalidrawAPI={handleExcalidrawApi}
                onChange={handleExcalidrawChange}
                onScrollChange={handleScroll}
                onPointerDown={handleCanvasPointerDown}
                onPointerUp={handleCanvasPointerUp}
              />
            </Suspense>
          ) : (
            <BoardFallback />
          )}

          {dropActive ? (
            <div className="board-canvas-drop" aria-hidden="true">
              <span>{t("放到画布上")}</span>
            </div>
          ) : null}

          {!presenting && !libraryOpen && (
            <button
              type="button"
              className="board-library-handle"
              aria-label={t("展开组件库")}
              onClick={() => setLibraryOpen(true)}
            >
              <Layers className="size-3.5" aria-hidden="true" />
              <span>{t("组件")}</span>
            </button>
          )}
        </fieldset>

        {!presenting && libraryOpen && (
          <BoardLibraryPanel
            entries={libraryEntries}
            loading={libraryLoading}
            insertingKey={insertingKey}
            onInsert={insertLibraryEntry}
            onPointerDown={handleLibraryPointerDown}
            onClose={closeLibrary}
          />
        )}
      </div>

      {dragGhost ? (
        <div
          className="board-library-ghost"
          style={{ left: dragGhost.x + 12, top: dragGhost.y + 12 }}
          aria-hidden="true"
        >
          <Layers className="size-3.5 shrink-0" />
          <span className="truncate">{dragGhost.entry.name}</span>
        </div>
      ) : null}

      <BoardHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="w-[380px] p-5" aria-describedby={undefined}>
          <DialogHeader
            title={t("重置画布？")}
            description={t("画布上的所有内容会被清空，此操作不可撤销。")}
          />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResetOpen(false)}>
              {t("取消")}
            </Button>
            <Button variant="destructive" size="sm" onClick={resetCanvas}>
              {t("重置画布")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * 视图入口：props 全部是稳定引用（nodeId/标题/稳定回调和已收敛的 nodes），
 * 外层 store 的无关更新（别的节点保存、侧栏开关）不再连带重渲染画布/编辑器。
 */
export const BoardView = memo(BoardViewImpl);
