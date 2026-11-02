import { useEffect, useState } from "react";
import { readAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { t } from "@/lib/i18n";

export interface AttachmentPreviewState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

/** 单张图片进入字节缓存的上限；更大的图直接读，避免缓存被一张大图占满。 */
const BYTE_CACHE_MAX_ENTRY = 4 * 1024 * 1024;
/** 字节缓存总量上限（LRU 淘汰）。 */
const BYTE_CACHE_MAX_TOTAL = 32 * 1024 * 1024;
const byteCache = new Map<string, ArrayBuffer>();
let byteCacheTotal = 0;

/** 命中缓存并把该条移到队尾（最近使用）。 */
function cachedBytes(id: string): ArrayBuffer | null {
  const hit = byteCache.get(id);
  if (!hit) return null;
  byteCache.delete(id);
  byteCache.set(id, hit);
  return hit;
}

/** 写入字节缓存；超上限按最早使用顺序淘汰。 */
function cacheBytes(id: string, bytes: ArrayBuffer): void {
  if (bytes.byteLength > BYTE_CACHE_MAX_ENTRY) return;
  const existing = byteCache.get(id);
  if (existing) {
    byteCacheTotal -= existing.byteLength;
    byteCache.delete(id);
  }
  byteCache.set(id, bytes);
  byteCacheTotal += bytes.byteLength;
  while (byteCacheTotal > BYTE_CACHE_MAX_TOTAL) {
    const oldest = byteCache.keys().next().value;
    if (oldest === undefined) break;
    const value = byteCache.get(oldest);
    byteCache.delete(oldest);
    byteCacheTotal -= value?.byteLength ?? 0;
  }
}

/**
 * 按 attachmentId 读取图片字节并生成 Blob URL。
 *
 * 预览只存在内存；卸载/ID 变化立即 revoke。读取失败（附件被删、超过 20 MiB）
 * 以 error 表达，不抛给 React。
 *
 * 字节走模块级 LRU 缓存：切标签页、重开文档、同一张图在附件页与正文里各挂一次，
 * 都不再重复 IPC 读盘（此前每次挂载都整张重读，最大 20 MiB）。
 */
export function useAttachmentPreview(attachmentId: string | null, mime: string): AttachmentPreviewState {
  const [state, setState] = useState<AttachmentPreviewState>({
    url: null,
    loading: Boolean(attachmentId),
    error: attachmentId ? null : t("附件不可用"),
  });

  useEffect(() => {
    if (!attachmentId) {
      setState({ url: null, loading: false, error: t("附件不可用") });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, loading: true, error: null });
    void (async () => {
      try {
        const cached = cachedBytes(attachmentId);
        const bytes = cached ?? (await readAttachmentBytes(attachmentId));
        if (!cached) cacheBytes(attachmentId, bytes);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setState({ url: objectUrl, loading: false, error: null });
      } catch (caught) {
        if (!cancelled) {
          setState({ url: null, loading: false, error: toErrorMessage(caught) });
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId, mime]);

  return state;
}
