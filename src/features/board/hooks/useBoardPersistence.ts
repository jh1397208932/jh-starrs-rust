/**
 * 画板自动保存：去抖 + 最大等待 + 单飞 + 失败退避 + 视口独立保存。
 *
 * onChange 只更新最新快照并标脏；序列化与 IPC 都推迟到保存时刻。
 * 图片已在粘贴时进入全局对象库，本 hook 不传输文件字节。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadBoard, saveBoard, saveBoardViewport } from "@/api/board";
import { isConflictError, toErrorMessage } from "@/api/client";
import { t } from "@/lib/i18n";
import type { BoardAppState, BoardFile, BoardSaveStatus, BoardViewport } from "@/types/board";

const SCENE_DEBOUNCE_MS = 800;
const SCENE_MAX_WAIT_MS = 5_000;
const VIEWPORT_DEBOUNCE_MS = 1_200;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 10_000;

interface UseBoardPersistenceOptions {
  nodeId: string;
  onSaved: (updatedAt: number) => void;
  onError: (message: string) => void;
}

export interface BoardInitialData {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, BoardFile>;
}

export interface BoardPersistence {
  status: BoardSaveStatus;
  initialData: BoardInitialData | null;
  loadError: string | null;
  missingObjectIds: string[];
  onSceneChange: (elements: readonly unknown[], appState: Record<string, unknown>) => void;
  onScrollChange: (scrollX: number, scrollY: number, zoom: number) => void;
  onPointerDown: () => void;
  onPointerUp: () => void;
  flush: () => Promise<boolean>;
  retry: () => void;
  reload: () => void;
}

interface SceneSnapshot {
  elements: readonly unknown[];
  appState: BoardAppState;
  sceneVersion: number;
}

/** Excalidraw sceneVersion 的轻量实现；避免从这里静态 import 整个包。 */
function sceneVersionOf(elements: readonly unknown[]): number {
  let version = 0;
  for (const element of elements) {
    if (typeof element !== "object" || element === null) continue;
    const record = element as { version?: unknown; versionNonce?: unknown };
    if (typeof record.version === "number") version += record.version;
    if (typeof record.versionNonce === "number") version += record.versionNonce;
  }
  return version;
}

/** 只取 cleanAppStateForExport 白名单；JSON.stringify 用于比较变化。 */
function pickAppState(appState: Record<string, unknown>): BoardAppState {
  const picked: BoardAppState = {};
  if (typeof appState.viewBackgroundColor === "string") {
    picked.viewBackgroundColor = appState.viewBackgroundColor;
  }
  if (typeof appState.gridModeEnabled === "boolean") {
    picked.gridModeEnabled = appState.gridModeEnabled;
  }
  if (typeof appState.gridSize === "number" || appState.gridSize === null) {
    picked.gridSize = appState.gridSize;
  }
  if (typeof appState.gridStep === "number") {
    picked.gridStep = appState.gridStep;
  }
  return picked;
}

function sameViewport(left: BoardViewport, right: BoardViewport): boolean {
  return left.scrollX === right.scrollX && left.scrollY === right.scrollY && left.zoom === right.zoom;
}

/**
 * 画板持久化状态机。
 * @param options 画板节点与保存成功/失败回调
 * @returns 初始场景、保存状态与 Excalidraw 回调
 */
export function useBoardPersistence({
  nodeId,
  onSaved,
  onError,
}: UseBoardPersistenceOptions): BoardPersistence {
  const [status, setStatus] = useState<BoardSaveStatus>("loading");
  const [initialData, setInitialData] = useState<BoardInitialData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missingObjectIds, setMissingObjectIds] = useState<string[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const statusRef = useRef<BoardSaveStatus>("loading");
  const versionRef = useRef(0);
  const loadTokenRef = useRef(0);
  const nodeIdRef = useRef(nodeId);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const pointerDownRef = useRef(false);
  const latestRef = useRef<SceneSnapshot | null>(null);
  const lastSavedSceneVersionRef = useRef<number | null>(null);
  const lastSavedAppStateRef = useRef("");
  const baselineReadyRef = useRef(false);
  const baselinePendingRef = useRef(false);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const inFlightSnapshotRef = useRef<SceneSnapshot | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryDelayRef = useRef(RETRY_BASE_MS);
  const sceneTimerRef = useRef<number | null>(null);
  const maxWaitTimerRef = useRef<number | null>(null);
  const viewportTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<BoardViewport | null>(null);
  const viewportSavedRef = useRef<BoardViewport | null>(null);
  const viewportDirtyRef = useRef(false);
  const viewportSavingRef = useRef(false);
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);
  const saveNowRef = useRef<() => Promise<boolean>>(async () => false);
  const scheduleSceneSaveRef = useRef<(delay?: number) => void>(() => undefined);
  const flushViewportRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    onSavedRef.current = onSaved;
    onErrorRef.current = onError;
  }, [onSaved, onError]);

  const updateStatus = useCallback((next: BoardSaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearSceneTimers = useCallback(() => {
    if (sceneTimerRef.current !== null) {
      window.clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = null;
    }
    if (maxWaitTimerRef.current !== null) {
      window.clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const clearViewportTimer = useCallback(() => {
    if (viewportTimerRef.current !== null) {
      window.clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = null;
    }
  }, []);

  const flushViewport = useCallback(async () => {
    clearViewportTimer();
    if (!viewportDirtyRef.current || viewportSavingRef.current) return;
    const snapshot = viewportRef.current;
    if (!snapshot) return;
    const token = loadTokenRef.current;
    const targetNode = nodeIdRef.current;
    viewportDirtyRef.current = false;
    viewportSavingRef.current = true;
    try {
      const saved = await saveBoardViewport({ nodeId: targetNode, ...snapshot });
      if (loadTokenRef.current === token) viewportSavedRef.current = saved;
    } catch {
      // 视口不是正文，失败不打扰用户；保留脏标记，下次滚动或 flush 再试。
      if (loadTokenRef.current === token) viewportDirtyRef.current = true;
    } finally {
      viewportSavingRef.current = false;
    }
  }, [clearViewportTimer]);
  useEffect(() => {
    flushViewportRef.current = flushViewport;
  }, [flushViewport]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    clearSceneTimers();
    if (savingRef.current) {
      pendingRef.current = true;
      return inFlightRef.current ?? false;
    }
    const snapshot = latestRef.current;
    if (!dirtyRef.current || !snapshot) return statusRef.current !== "conflict";
    const token = loadTokenRef.current;
    const targetNode = nodeIdRef.current;
    dirtyRef.current = false;
    pendingRef.current = false;
    savingRef.current = true;
    inFlightSnapshotRef.current = snapshot;
    updateStatus("saving");
    const promise = (async () => {
      try {
        const result = await saveBoard({
          nodeId: targetNode,
          baseVersion: versionRef.current,
          elements: [...snapshot.elements],
          appState: snapshot.appState,
        });
        if (loadTokenRef.current !== token) return true;
        versionRef.current = result.version;
        lastSavedSceneVersionRef.current = snapshot.sceneVersion;
        lastSavedAppStateRef.current = JSON.stringify(snapshot.appState);
        retryDelayRef.current = RETRY_BASE_MS;
        updateStatus("saved");
        onSavedRef.current(result.updatedAt);
        if (dirtyRef.current) scheduleSceneSaveRef.current(0);
        return true;
      } catch (error) {
        if (loadTokenRef.current !== token) return false;
        dirtyRef.current = true;
        const message = toErrorMessage(error);
        // 冲突按原始错误文本判定，英文界面下也走同一条路径。
        if (isConflictError(error)) {
          updateStatus("conflict");
          onErrorRef.current(t(message));
          return false;
        }
        updateStatus("error");
        onErrorRef.current(t(message));
        const delay = retryDelayRef.current;
        retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
        if (retryTimerRef.current === null) {
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            void saveNowRef.current();
          }, delay);
        }
        return false;
      } finally {
        savingRef.current = false;
        inFlightSnapshotRef.current = null;
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = promise;
    return promise;
  }, [clearSceneTimers, updateStatus]);
  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  const scheduleSceneSave = useCallback((delay = SCENE_DEBOUNCE_MS) => {
    if (sceneTimerRef.current !== null) window.clearTimeout(sceneTimerRef.current);
    if (pointerDownRef.current) {
      sceneTimerRef.current = null;
      return;
    }
    sceneTimerRef.current = window.setTimeout(() => {
      sceneTimerRef.current = null;
      void saveNowRef.current();
    }, delay);
    if (maxWaitTimerRef.current === null) {
      maxWaitTimerRef.current = window.setTimeout(() => {
        maxWaitTimerRef.current = null;
        void saveNowRef.current();
      }, SCENE_MAX_WAIT_MS);
    }
  }, []);
  useEffect(() => {
    scheduleSceneSaveRef.current = scheduleSceneSave;
  }, [scheduleSceneSave]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearSceneTimers();
    if (inFlightRef.current) await inFlightRef.current;
    if (dirtyRef.current && statusRef.current !== "conflict") await saveNowRef.current();
    await flushViewportRef.current();
    return statusRef.current !== "error" && statusRef.current !== "conflict" && !dirtyRef.current;
  }, [clearSceneTimers]);

  const onSceneChange = useCallback((elements: readonly unknown[], appState: Record<string, unknown>) => {
    if (!baselineReadyRef.current || statusRef.current === "conflict") return;
    const nextAppState = pickAppState(appState);
    const nextVersion = sceneVersionOf(elements);
    const appStateJson = JSON.stringify(nextAppState);
    latestRef.current = { elements, appState: nextAppState, sceneVersion: nextVersion };
    // 首次 onChange 来自 Excalidraw 的挂载/恢复，只建立基线，不写库。
    if (baselinePendingRef.current) {
      baselinePendingRef.current = false;
      lastSavedSceneVersionRef.current = nextVersion;
      lastSavedAppStateRef.current = appStateJson;
      return;
    }
    if (lastSavedSceneVersionRef.current === null) {
      lastSavedSceneVersionRef.current = nextVersion;
      lastSavedAppStateRef.current = appStateJson;
      return;
    }
    // 保存期间 Excalidraw 可能再次回调相同的场景；忽略回声，避免重复写库。
    const inFlight = inFlightSnapshotRef.current;
    if (
      inFlight &&
      nextVersion === inFlight.sceneVersion &&
      appStateJson === JSON.stringify(inFlight.appState)
    ) {
      return;
    }
    if (nextVersion === lastSavedSceneVersionRef.current && appStateJson === lastSavedAppStateRef.current) {
      return;
    }
    dirtyRef.current = true;
    scheduleSceneSaveRef.current();
  }, []);

  const onScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: number) => {
      if (!baselineReadyRef.current) return;
      const next = { scrollX, scrollY, zoom };
      viewportRef.current = next;
      if (viewportSavedRef.current && sameViewport(viewportSavedRef.current, next)) return;
      viewportDirtyRef.current = true;
      clearViewportTimer();
      viewportTimerRef.current = window.setTimeout(() => {
        viewportTimerRef.current = null;
        void flushViewportRef.current();
      }, VIEWPORT_DEBOUNCE_MS);
    },
    [clearViewportTimer],
  );

  const onPointerDown = useCallback(() => {
    pointerDownRef.current = true;
    clearSceneTimers();
  }, [clearSceneTimers]);

  const onPointerUp = useCallback(() => {
    pointerDownRef.current = false;
    if (dirtyRef.current) scheduleSceneSaveRef.current(0);
  }, []);

  const retry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryDelayRef.current = RETRY_BASE_MS;
    void saveNowRef.current();
  }, []);

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken 仅作为“重新加载”触发器
  useEffect(() => {
    nodeIdRef.current = nodeId;
    const token = loadTokenRef.current + 1;
    loadTokenRef.current = token;
    baselineReadyRef.current = false;
    baselinePendingRef.current = false;
    latestRef.current = null;
    lastSavedSceneVersionRef.current = null;
    lastSavedAppStateRef.current = "";
    dirtyRef.current = false;
    savingRef.current = false;
    pendingRef.current = false;
    pointerDownRef.current = false;
    inFlightRef.current = null;
    inFlightSnapshotRef.current = null;
    viewportRef.current = null;
    viewportSavedRef.current = null;
    viewportDirtyRef.current = false;
    viewportSavingRef.current = false;
    clearSceneTimers();
    clearViewportTimer();
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setInitialData(null);
    setLoadError(null);
    setMissingObjectIds([]);
    updateStatus("loading");

    void loadBoard(nodeId)
      .then((result) => {
        if (loadTokenRef.current !== token) return;
        versionRef.current = result.version;
        lastSavedSceneVersionRef.current = sceneVersionOf(result.elements);
        lastSavedAppStateRef.current = JSON.stringify(result.appState);
        viewportRef.current = result.viewport;
        viewportSavedRef.current = result.viewport;
        setMissingObjectIds(result.missingObjectIds);
        setInitialData({
          elements: result.elements,
          appState: {
            ...result.appState,
            scrollX: result.viewport.scrollX,
            scrollY: result.viewport.scrollY,
            zoom: { value: result.viewport.zoom },
          },
          files: Object.fromEntries(result.files.map((file) => [file.id, file])),
        });
        baselineReadyRef.current = true;
        baselinePendingRef.current = true;
        updateStatus("saved");
      })
      .catch((error) => {
        if (loadTokenRef.current !== token) return;
        setLoadError(toErrorMessage(error));
        updateStatus("error");
      });
  }, [nodeId, reloadToken, clearSceneTimers, clearViewportTimer, updateStatus]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flush]);

  useEffect(
    () => () => {
      baselineReadyRef.current = false;
      clearSceneTimers();
      clearViewportTimer();
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [clearSceneTimers, clearViewportTimer],
  );

  return {
    status,
    initialData,
    loadError,
    missingObjectIds,
    onSceneChange,
    onScrollChange,
    onPointerDown,
    onPointerUp,
    flush,
    retry,
    reload,
  };
}
