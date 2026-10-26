/**
 * 文档自动保存：1s 防抖 + 单飞互斥 + 锁冲突延长 1s。
 *
 * 关键语义：
 * - 只有拿到锁之后才调用 `editor.getJSON()`，取的是那一刻的最新文档；
 * - 保存进行中再次触发保存只延长本次尝试 1s，不取消新编辑的防抖；
 * - 保存期间的新编辑保持 dirty，结束后再排一次 1s 保存；
 * - 切换文档前可用 `flush()` 强制落盘，失败时保留 dirty 并返回 false。
 */

import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveDocument } from "@/api/document";
import type { DocSaveResult } from "@/types/document";
import type { SaveStatus } from "../types";

const DEBOUNCE_MS = 1000;
const LOCK_RETRY_MS = 1000;
const FLUSH_MAX_PASSES = 4;

export interface DocumentPersistenceOptions {
  onSaved?: (result: DocSaveResult) => void;
  onError?: (error: unknown) => void;
}

export interface DocumentPersistence {
  editorRef: React.MutableRefObject<Editor | null>;
  status: SaveStatus;
  wordCount: number;
  updatedAt: number;
  /** 编辑后标记 dirty 并重置 1s 防抖 */
  markDirty: () => void;
  /** 切换文档时重置保存器；必须在 flush 成功后调用 */
  beginDocument: (nodeId: string | null) => void;
  /** 加载完成后同步持久化读数 */
  setBaseline: (wordCount: number, updatedAt: number, version: number) => void;
  /** 失败后手动重试 */
  retry: () => Promise<void>;
  /** 丢弃本地 dirty 状态，供冲突后强制重新加载 */
  discard: () => void;
  /** 立即保存所有 dirty 内容；返回是否已全部落盘 */
  flush: () => Promise<boolean>;
}

export function useDocumentPersistence(
  editor: Editor | null,
  options: DocumentPersistenceOptions = {},
): DocumentPersistence {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [wordCount, setWordCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState(0);

  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;
  const nodeIdRef = useRef<string | null>(null);
  const baseVersionRef = useRef(0);
  const dirtyRef = useRef(false);
  const failedRef = useRef(false);
  const savingRef = useRef(false);
  const savingPromiseRef = useRef<Promise<void> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const attemptRef = useRef<() => Promise<void>>(async () => undefined);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clearTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      generationRef.current += 1;
    },
    [clearTimers],
  );

  const scheduleDebounce = useCallback((delay = DEBOUNCE_MS) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void attemptRef.current();
    }, delay);
  }, []);

  const beginSave = useCallback((): Promise<void> => {
    if (savingRef.current) return savingPromiseRef.current ?? Promise.resolve();

    const run = (async () => {
      savingRef.current = true;
      failedRef.current = false;
      dirtyRef.current = false;
      setStatus("saving");
      const generation = generationRef.current;
      const nodeId = nodeIdRef.current;
      const currentEditor = editorRef.current;

      if (!nodeId || !currentEditor || currentEditor.isDestroyed) {
        savingRef.current = false;
        savingPromiseRef.current = null;
        dirtyRef.current = true;
        setStatus("dirty");
        return;
      }

      let document: ReturnType<Editor["getJSON"]>;
      try {
        // 只有拿到单飞锁之后才读取快照，保证写入的是最新可提交状态。
        document = currentEditor.getJSON();
      } catch (error) {
        savingRef.current = false;
        savingPromiseRef.current = null;
        failedRef.current = true;
        dirtyRef.current = true;
        setStatus("error");
        callbacksRef.current.onError?.(error);
        return;
      }

      try {
        const result = await saveDocument(nodeId, document, baseVersionRef.current);
        if (generation !== generationRef.current) return;
        baseVersionRef.current = result.version;
        setWordCount(result.wordCount);
        setUpdatedAt(result.updatedAt);
        callbacksRef.current.onSaved?.(result);
        if (dirtyRef.current) {
          setStatus("dirty");
          scheduleDebounce();
        } else {
          setStatus("saved");
        }
      } catch (error) {
        if (generation !== generationRef.current) return;
        failedRef.current = true;
        dirtyRef.current = true;
        setStatus("error");
        callbacksRef.current.onError?.(error);
      } finally {
        savingRef.current = false;
        savingPromiseRef.current = null;
      }
    })();

    savingPromiseRef.current = run;
    return run;
  }, [scheduleDebounce]);

  const attemptSave = useCallback(async () => {
    if (!nodeIdRef.current || !dirtyRef.current) return;
    if (savingRef.current) {
      // 锁冲突：本次尝试 1s 后再试；新编辑的防抖计时器不受影响。
      if (!retryTimerRef.current) {
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void attemptRef.current();
        }, LOCK_RETRY_MS);
      }
      return;
    }
    await beginSave();
  }, [beginSave]);

  attemptRef.current = attemptSave;

  const markDirty = useCallback(() => {
    if (!nodeIdRef.current) return;
    dirtyRef.current = true;
    failedRef.current = false;
    setStatus("dirty");
    scheduleDebounce();
  }, [scheduleDebounce]);

  const beginDocument = useCallback(
    (nodeId: string | null) => {
      generationRef.current += 1;
      clearTimers();
      nodeIdRef.current = nodeId;
      baseVersionRef.current = 0;
      dirtyRef.current = false;
      failedRef.current = false;
      setStatus("idle");
    },
    [clearTimers],
  );

  const setBaseline = useCallback((nextWordCount: number, nextUpdatedAt: number, nextVersion: number) => {
    baseVersionRef.current = nextVersion;
    setWordCount(nextWordCount);
    setUpdatedAt(nextUpdatedAt);
    setStatus("saved");
  }, []);

  const retry = useCallback(async () => {
    if (!nodeIdRef.current) return;
    dirtyRef.current = true;
    failedRef.current = false;
    await beginSave();
  }, [beginSave]);

  /** 冲突后放弃本地修改：只清 dirty/失败标记，不触碰编辑器内容。 */
  const discard = useCallback(() => {
    generationRef.current += 1;
    clearTimers();
    dirtyRef.current = false;
    failedRef.current = false;
    setStatus("idle");
  }, [clearTimers]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimers();
    if (savingRef.current) await savingPromiseRef.current;
    if (failedRef.current) return false;

    for (let pass = 0; pass < FLUSH_MAX_PASSES; pass += 1) {
      if (!dirtyRef.current || !nodeIdRef.current) break;
      await beginSave();
      if (failedRef.current) break;
    }
    clearTimers();
    return !failedRef.current && !dirtyRef.current;
  }, [beginSave, clearTimers]);

  return {
    editorRef,
    status,
    wordCount,
    updatedAt,
    markDirty,
    beginDocument,
    setBaseline,
    retry,
    discard,
    flush,
  };
}
