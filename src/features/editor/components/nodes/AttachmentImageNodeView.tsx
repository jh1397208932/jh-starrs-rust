import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Download, ImageOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AttachmentImageAttrs, AttachmentNodeViewOptions } from "../../extensions/attachmentTypes";
import { exportAttachment } from "../../utils/exportAttachment";
import { useAttachmentPreview } from "./useAttachmentPreview";

const MIN_IMAGE_WIDTH = 120;
const HANDLE_WIDTH = 10;

function attrNumber(node: ProseMirrorNode, key: string): number {
  const value = node.attrs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function attrString(node: ProseMirrorNode, key: string): string {
  const value = node.attrs[key];
  return typeof value === "string" ? value : "";
}

function attrAlign(node: ProseMirrorNode): AttachmentImageAttrs["align"] {
  const value = node.attrs.align;
  return value === "center" || value === "right" ? value : "left";
}

/** 图片块 NodeView：附件预览、左/中/右对齐、左右拖拽缩放、下载原图。 */
export function AttachmentImageNodeView(props: ReactNodeViewProps) {
  const { t } = useI18n();
  const { node, selected, updateAttributes, editor } = props;
  const attachmentId = attrString(node, "attachmentId") || null;
  const name = attrString(node, "name") || t("图片");
  const mime = attrString(node, "mime");
  const alt = attrString(node, "alt") || name;
  const align = attrAlign(node);
  const options = props.extension.options as unknown as AttachmentNodeViewOptions;
  const preview = useAttachmentPreview(attachmentId, mime);
  const frameRef = useRef<HTMLFieldSetElement | null>(null);
  const widthRef = useRef(attrNumber(node, "width"));
  const [width, setWidth] = useState(widthRef.current);
  const [downloading, setDownloading] = useState(false);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const aliveRef = useRef(true);
  const widthAttr = attrNumber(node, "width");

  useEffect(() => {
    if (widthAttr !== widthRef.current) {
      widthRef.current = widthAttr;
      setWidth(widthAttr);
    }
  }, [widthAttr]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      cleanupResizeRef.current?.();
    };
  }, []);

  const setDraftWidth = useCallback((next: number) => {
    widthRef.current = next;
    setWidth(next);
  }, []);

  const selectBlock = useCallback(() => {
    const pos = typeof props.getPos === "function" ? props.getPos() : undefined;
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  }, [editor, props]);

  const handleImageLoad = (image: HTMLImageElement) => {
    if (widthRef.current > 0) return;
    const maxWidth = Math.max(editor.view.dom.clientWidth, MIN_IMAGE_WIDTH);
    const natural = image.naturalWidth || maxWidth;
    setDraftWidth(Math.min(natural, maxWidth));
  };

  const setAlign = (next: AttachmentImageAttrs["align"]) => {
    updateAttributes({ align: next });
  };

  const handleDownload = async () => {
    if (!attachmentId || downloading) return;
    setDownloading(true);
    try {
      await exportAttachment(attachmentId, name, options.onError);
    } finally {
      setDownloading(false);
    }
  };

  const startResize = (side: "left" | "right", event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectBlock();
    const startX = event.clientX;
    const startWidth = frameRef.current?.getBoundingClientRect().width ?? widthRef.current;
    const maxWidth = Math.max(editor.view.dom.clientWidth, MIN_IMAGE_WIDTH);
    const handle = event.currentTarget;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败时窗口监听仍可用。
    }
    document.body.classList.add("starris-image-resizing");

    const finish = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.classList.remove("starris-image-resizing");
      cleanupResizeRef.current = null;
      if (aliveRef.current) {
        updateAttributes({ width: Math.round(widthRef.current) });
      }
    };
    const handleMove = (move: PointerEvent) => {
      const delta = side === "right" ? move.clientX - startX : startX - move.clientX;
      const next = Math.min(Math.max(startWidth + delta, MIN_IMAGE_WIDTH), maxWidth);
      setDraftWidth(Math.round(next));
    };

    cleanupResizeRef.current = finish;
    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const shellStyle = width > 0 ? { width: `${Math.round(width)}px` } : undefined;

  return (
    <NodeViewWrapper
      className={cn("attachment-image-block", selected && "is-selected")}
      data-align={align}
      data-selected={selected}
      contentEditable={false}
    >
      <div className="attachment-image-shell" style={shellStyle}>
        {selected && (
          <div
            className="attachment-image-toolbar"
            role="toolbar"
            aria-label={t("图片操作")}
            data-visible="true"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "left"}
              aria-label={t("图片左对齐")}
              title={t("左对齐")}
              onClick={() => setAlign("left")}
            >
              <AlignLeft className="size-3.5" />
            </button>
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "center"}
              aria-label={t("图片居中")}
              title={t("居中")}
              onClick={() => setAlign("center")}
            >
              <AlignCenter className="size-3.5" />
            </button>
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "right"}
              aria-label={t("图片右对齐")}
              title={t("右对齐")}
              onClick={() => setAlign("right")}
            >
              <AlignRight className="size-3.5" />
            </button>
            <span className="attachment-toolbar__divider" aria-hidden="true" />
            <button
              type="button"
              className="attachment-toolbar__button"
              aria-label={t("下载原图")}
              title={t("下载原图")}
              disabled={!attachmentId || downloading}
              onClick={() => void handleDownload()}
            >
              {downloading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
            </button>
          </div>
        )}

        <fieldset
          ref={frameRef}
          className="attachment-image-frame"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const target = event.target;
            if (target instanceof Element && target.closest(".attachment-image-toolbar")) return;
            event.preventDefault();
            selectBlock();
          }}
        >
          {preview.loading && (
            <div className="attachment-image-placeholder">
              <Loader2 className="size-5 animate-spin" />
              <span>{t("正在加载图片…")}</span>
            </div>
          )}
          {!preview.loading && preview.url && (
            <img
              src={preview.url}
              alt={alt}
              draggable={false}
              className="attachment-image-view"
              onLoad={(event) => handleImageLoad(event.currentTarget)}
            />
          )}
          {!preview.loading && !preview.url && (
            <div className="attachment-image-placeholder is-error">
              <ImageOff className="size-5" />
              <span>{preview.error ?? t("图片无法预览")}</span>
              {attachmentId && (
                <button type="button" className="attachment-image-retry" onClick={handleDownload}>
                  {t("下载原图")}
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            className="attachment-image-handle is-left"
            aria-label={t("向左调整图片宽度")}
            tabIndex={-1}
            style={{ width: HANDLE_WIDTH }}
            onPointerDown={(event) => startResize("left", event)}
          />
          <button
            type="button"
            className="attachment-image-handle is-right"
            aria-label={t("向右调整图片宽度")}
            tabIndex={-1}
            style={{ width: HANDLE_WIDTH }}
            onPointerDown={(event) => startResize("right", event)}
          />
        </fieldset>
      </div>
    </NodeViewWrapper>
  );
}
