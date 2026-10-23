import { useEffect, useState } from "react";
import { readAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";

export interface AttachmentPreviewState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * 按 attachmentId 读取图片字节并生成 Blob URL。
 *
 * 预览只存在内存；卸载/ID 变化立即 revoke。读取失败（附件被删、超过 20 MiB）
 * 以 error 表达，不抛给 React。
 */
export function useAttachmentPreview(attachmentId: string | null, mime: string): AttachmentPreviewState {
  const [state, setState] = useState<AttachmentPreviewState>({
    url: null,
    loading: Boolean(attachmentId),
    error: attachmentId ? null : "缺少附件 id",
  });

  useEffect(() => {
    if (!attachmentId) {
      setState({ url: null, loading: false, error: "缺少附件 id" });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ url: null, loading: true, error: null });
    void (async () => {
      try {
        const bytes = await readAttachmentBytes(attachmentId);
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
