/**
 * 思维导图自动保存：去抖、最大等待、单飞、失败退避与视口独立保存。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isConflictError, toErrorMessage } from "@/api/client";
import { loadMindmap, saveMindmap, saveMindmapViewport } from "@/api/mindmap";
import { registerActivePersistence, unregisterActivePersistence } from "@/features/editor/activeDocument";
import type {
  MindmapContent,
  MindmapFile,
  MindmapLoadResult,
  MindmapSaveStatus,
  MindmapViewport,
} from "@/types/mindmap";

const CONTENT_DEBOUNCE_MS = 800;
const CONTENT_MAX_WAIT_MS = 5_000;
const VIEWPORT_DEBOUNCE_MS = 1_200;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 10_000;

interface UseMindmapPersistenceOptions {
  nodeId: string;
  onSaved: (updatedAt: number, topicCount: number) => void;
  onError: (message: string) => void;
}

export interface MindmapPersistence {
  status: MindmapSaveStatus;
  initial: MindmapLoadResult | null;
  loadError: string | null;
  onContentChange: (content: MindmapContent) => void;
  onViewportChange: (viewport: MindmapViewport) => void;
  flush: () => Promise<boolean>;
  retry: () => void;
  reload: () => void;
}

/** 管理导图场景与视口持久化。 */
export function useMindmapPersistence({
  nodeId,
  onSaved,
  onError,
}: UseMindmapPersistenceOptions): MindmapPersistence {
  const [status, setStatus] = useState<MindmapSaveStatus>("loading");
  const [initial, setInitial] = useState<MindmapLoadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const ownerRef = useRef(Symbol("starris-mindmap"));
  const statusRef = useRef<MindmapSaveStatus>("loading");
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const latestRef = useRef<MindmapContent | null>(null);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const retryDelayRef = useRef(RETRY_BASE_MS);
  const contentTimerRef = useRef<number | null>(null);
  const maxWaitRef = useRef<number | null>(null);
  const viewportTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<MindmapViewport | null>(null);
  const viewportSavedRef = useRef<MindmapViewport | null>(null);
  const scheduleRetryRef = useRef<() => void>(() => {});

  const setStatusValue = useCallback((value: MindmapSaveStatus) => {
    statusRef.current = value;
    setStatus(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestVersion = reloadToken;
    setStatusValue("loading");
    setLoadError(null);
    // 换图/重载必须先清空：否则画布会用上一张图的 content 与视口初始化，
    // 且视口只初始化一次，新场景加载完也不会再纠正。
    setInitial(null);
    void loadMindmap(nodeId)
      .then((result) => {
        if (cancelled || requestVersion !== reloadToken) return;
        setInitial(result);
        versionRef.current = result.version;
        viewportRef.current = result.viewport;
        viewportSavedRef.current = result.viewport;
        latestRef.current = result.content;
        dirtyRef.current = false;
        setStatusValue("saved");
      })
      .catch((error: unknown) => {
        if (cancelled || requestVersion !== reloadToken) return;
        setLoadError(toErrorMessage(error));
        setStatusValue("error");
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, reloadToken, setStatusValue]);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      // 在途保存期间的改动不能被丢掉：标记 pending，等当前保存结束后再取最新内容。
      pendingRef.current = true;
      return inFlightRef.current ?? true;
    }
    const content = latestRef.current;
    if (!content) return true;
    savingRef.current = true;
    const baseVersion = versionRef.current;
    const task = (async () => {
      try {
        setStatusValue("saving");
        const result = await saveMindmap({ nodeId, baseVersion, content });
        versionRef.current = result.version;
        onSaved(result.updatedAt, result.topicCount);
        if (latestRef.current === content) {
          dirtyRef.current = false;
        } else {
          pendingRef.current = true;
        }
        setStatusValue("saved");
        retryDelayRef.current = RETRY_BASE_MS;
        return true;
      } catch (error) {
        if (isConflictError(error)) setStatusValue("conflict");
        else {
          const message = toErrorMessage(error);
          setStatusValue("error");
          onError(message);
          scheduleRetryRef.current();
        }
        return false;
      } finally {
        savingRef.current = false;
        inFlightRef.current = null;
        if (pendingRef.current) {
          pendingRef.current = false;
          void saveNow();
        }
      }
    })();
    inFlightRef.current = task;
    return task;
  }, [nodeId, onError, onSaved, setStatusValue]);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, RETRY_MAX_MS);
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void saveNow();
    }, delay);
  }, [saveNow]);
  scheduleRetryRef.current = scheduleRetry;

  const flush = useCallback(async () => {
    if (contentTimerRef.current !== null) {
      window.clearTimeout(contentTimerRef.current);
      contentTimerRef.current = null;
    }
    if (maxWaitRef.current !== null) {
      window.clearTimeout(maxWaitRef.current);
      maxWaitRef.current = null;
    }
    // 在途保存可能正带着旧内容；等它结束后 pending 逻辑会再存一次最新内容，
    // 所以这里要循环等待，直到没有在途任务且 dirty 清空。
    let failed = false;
    while (savingRef.current && inFlightRef.current) {
      const ok = await inFlightRef.current;
      if (!ok) failed = true;
    }
    if (!dirtyRef.current) return true;
    // 失败后交给退避重试，flush 不再立刻重打一次。
    return failed ? false : saveNow();
  }, [saveNow]);

  const onContentChange = useCallback(
    (content: MindmapContent) => {
      latestRef.current = content;
      dirtyRef.current = true;
      if (statusRef.current !== "conflict") setStatusValue("saving");
      if (contentTimerRef.current !== null) window.clearTimeout(contentTimerRef.current);
      contentTimerRef.current = window.setTimeout(() => {
        contentTimerRef.current = null;
        void saveNow();
      }, CONTENT_DEBOUNCE_MS);
      if (maxWaitRef.current === null) {
        maxWaitRef.current = window.setTimeout(() => {
          maxWaitRef.current = null;
          void saveNow();
        }, CONTENT_MAX_WAIT_MS);
      }
    },
    [saveNow, setStatusValue],
  );

  const onViewportChange = useCallback(
    (viewport: MindmapViewport) => {
      viewportRef.current = viewport;
      if (viewportTimerRef.current !== null) window.clearTimeout(viewportTimerRef.current);
      viewportTimerRef.current = window.setTimeout(() => {
        viewportTimerRef.current = null;
        const current = viewportRef.current;
        if (!current || sameViewport(current, viewportSavedRef.current)) return;
        viewportSavedRef.current = current;
        void saveMindmapViewport({ nodeId, ...current }).catch(() => undefined);
      }, VIEWPORT_DEBOUNCE_MS);
    },
    [nodeId],
  );

  useEffect(() => {
    registerActivePersistence(ownerRef.current, flush);
    return () => unregisterActivePersistence(ownerRef.current);
  }, [flush]);

  useEffect(
    () => () => {
      for (const timer of [contentTimerRef, maxWaitRef, viewportTimerRef, retryTimerRef]) {
        if (timer.current !== null) window.clearTimeout(timer.current);
      }
    },
    [],
  );

  return {
    status,
    initial,
    loadError,
    onContentChange,
    onViewportChange,
    flush,
    retry: () => void saveNow(),
    reload: () => setReloadToken((value) => value + 1),
  };
}

function sameViewport(left: MindmapViewport, right: MindmapViewport | null): boolean {
  return (
    right !== null && left.x === right.x && left.y === right.y && Math.abs(left.zoom - right.zoom) < 0.0001
  );
}

export type { MindmapFile };
