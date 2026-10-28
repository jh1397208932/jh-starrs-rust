import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import "../board.css";
import { uploadAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { listLibraryItems } from "@/api/library";
import { registerActivePersistence, unregisterActivePersistence } from "@/features/editor/activeDocument";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { CAPTION_CLS, cn } from "@/lib/utils";
import { LIBRARY_CHANGED_EVENT, type LibraryItem } from "@/types/library";
import { useBoardExport } from "../hooks/useBoardExport";
import { type BoardCanvasApi, useBoardFileIntake } from "../hooks/useBoardFileIntake";
import { type BoardShortcutHandlers, useBoardKeymap } from "../hooks/useBoardKeymap";
import { useBoardPersistence } from "../hooks/useBoardPersistence";
import { AttachmentPickerDialog } from "./AttachmentPickerDialog";
import { BoardLibraryPickerDialog } from "./BoardLibraryPickerDialog";
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
 * 图片粘贴由 `generateIdForFile` 先上传到附件对象库，fileId 即 object_id；
 * 非图片文件卡片与插入附件入口在后续步骤接入。
 */
export function BoardView({ nodeId, title, kbName, onSaved, onError, onOpenKb, onExported }: BoardViewProps) {
  const { locale, t } = useI18n();
  const { mode } = useTheme();
  const [api, setApi] = useState<BoardCanvasApi | null>(null);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[] | null>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
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
  const fileIntake = useBoardFileIntake({ nodeId, api, onError: showError });
  const boardExport = useBoardExport({ api, title, onError: showError, onExported });
  const boardShortcutHandlers = useMemo<BoardShortcutHandlers>(
    () => ({
      "board.insertAttachment": () => setAttachmentPickerOpen(true),
      "board.openLibrary": () => setLibraryPickerOpen(true),
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
    const loadLibraries = () => {
      void listLibraryItems()
        .then((items) => {
          if (!cancelled) setLibraryItems(items);
        })
        .catch(() => {
          if (!cancelled) setLibraryItems([]);
        });
    };
    loadLibraries();
    window.addEventListener(LIBRARY_CHANGED_EVENT, loadLibraries);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_CHANGED_EVENT, loadLibraries);
    };
  }, []);

  useEffect(() => {
    if (persistence.status === "saved") lastErrorRef.current = "";
  }, [persistence.status]);

  useEffect(() => {
    if (persistence.missingObjectIds.length === 0) return;
    showError(t("有 {count} 个图片或附件缺失", { count: persistence.missingObjectIds.length }));
  }, [persistence.missingObjectIds, showError, t]);

  useEffect(() => {
    const owner = Symbol("board-persistence");
    registerActivePersistence(owner, persistence.flush);
    return () => unregisterActivePersistence(owner);
  }, [persistence.flush]);

  /** 插入组件库条目：恢复元素、重映射 id/绑定后一并写入场景。 */
  const insertLibraryItem = useCallback(
    async (item: LibraryItem) => {
      if (!api) throw new Error(t("画板尚未加载完成"));
      const { restoreElements } = await import("@excalidraw/excalidraw");
      const restored = restoreElements(item.elements as never, null, { repairBindings: true });
      if (restored.length === 0) throw new Error(t("组件为空"));
      const appState = api.getAppState();
      const centerX = appState.width / (2 * appState.zoom.value) - appState.scrollX;
      const centerY = appState.height / (2 * appState.zoom.value) - appState.scrollY;
      const minX = Math.min(...restored.map((element) => element.x));
      const minY = Math.min(...restored.map((element) => element.y));
      const maxX = Math.max(...restored.map((element) => element.x + element.width));
      const maxY = Math.max(...restored.map((element) => element.y + element.height));
      const offsetX = centerX - (minX + maxX) / 2;
      const offsetY = centerY - (minY + maxY) / 2;
      const idMap = new Map(restored.map((element) => [element.id, crypto.randomUUID()]));
      const groupMap = new Map<string, string>();
      const mapGroup = (groupId: string) => {
        const mapped = groupMap.get(groupId) ?? crypto.randomUUID();
        groupMap.set(groupId, mapped);
        return mapped;
      };
      type BindingView = (typeof restored)[number] & {
        containerId?: string | null;
        frameId?: string | null;
        startBinding?: { elementId?: string } | null;
        endBinding?: { elementId?: string } | null;
      };
      const elements = restored.map((element) => {
        const source = element as unknown as BindingView;
        const clone = structuredClone(element) as Record<string, unknown>;
        clone.id = idMap.get(element.id) ?? element.id;
        clone.versionNonce = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
        clone.seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
        clone.updated = Date.now();
        clone.x = element.x + offsetX;
        clone.y = element.y + offsetY;
        clone.groupIds = element.groupIds.map(mapGroup);
        if (source.containerId && idMap.has(source.containerId)) {
          clone.containerId = idMap.get(source.containerId);
        }
        if (source.frameId && idMap.has(source.frameId)) {
          clone.frameId = idMap.get(source.frameId);
        }
        if (element.boundElements) {
          clone.boundElements = element.boundElements.map((bound) => ({
            ...bound,
            id: idMap.get(bound.id) ?? bound.id,
          }));
        }
        if (source.startBinding?.elementId && idMap.has(source.startBinding.elementId)) {
          clone.startBinding = {
            ...source.startBinding,
            elementId: idMap.get(source.startBinding.elementId),
          };
        }
        if (source.endBinding?.elementId && idMap.has(source.endBinding.elementId)) {
          clone.endBinding = {
            ...source.endBinding,
            elementId: idMap.get(source.endBinding.elementId),
          };
        }
        return clone;
      });
      api.updateScene({ elements: [...api.getSceneElements(), ...elements] });
    },
    [api, t],
  );

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
          onInsertAttachment={() => setAttachmentPickerOpen(true)}
          onOpenLibrary={() => setLibraryPickerOpen(true)}
          onExport={(format) => void boardExport.exportBoard(format)}
          onPresent={() => void togglePresentation()}
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
      <div className="board-excalidraw relative min-h-0 flex-1" onDropCapture={fileIntake.onDropCapture}>
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
        ) : persistence.initialData && libraryItems ? (
          <Suspense fallback={<BoardFallback />}>
            <Excalidraw
              key={nodeId}
              langCode={locale === "en-US" ? "en" : "zh-CN"}
              theme={mode}
              zenModeEnabled={presenting}
              initialData={persistence.initialData as unknown as ExcalidrawInitialData}
              UIOptions={BOARD_UI_OPTIONS}
              generateIdForFile={generateIdForFile}
              excalidrawAPI={(nextApi) => setApi(nextApi as unknown as BoardCanvasApi)}
              onPaste={fileIntake.onPaste}
              onChange={(elements, appState) =>
                persistence.onSceneChange(elements, appState as unknown as Record<string, unknown>)
              }
              onScrollChange={(scrollX, scrollY, zoom) =>
                persistence.onScrollChange(scrollX, scrollY, zoom.value)
              }
              onPointerDown={() => persistence.onPointerDown()}
              onPointerUp={() => persistence.onPointerUp()}
            />
          </Suspense>
        ) : (
          <BoardFallback />
        )}
      </div>
      <BoardLibraryPickerDialog
        open={libraryPickerOpen}
        onOpenChange={setLibraryPickerOpen}
        items={libraryItems ?? []}
        onInsert={insertLibraryItem}
        onError={showError}
      />
      <AttachmentPickerDialog
        open={attachmentPickerOpen}
        onOpenChange={setAttachmentPickerOpen}
        onInsert={fileIntake.insertAttachments}
        onError={showError}
      />
    </div>
  );
}
