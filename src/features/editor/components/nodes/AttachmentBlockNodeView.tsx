import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Download, LayoutGrid, Loader2, Rows3, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FileTypeIcon } from "@/features/attachments/components/FileTypeIcon";
import { formatAttachmentBytes } from "@/features/attachments/utils/format";
import { cn } from "@/lib/utils";
import {
  type AttachmentBlockAttrs,
  type AttachmentNodeItem,
  type AttachmentNodeViewOptions,
  normalizeAttachmentItem,
} from "../../extensions/attachmentTypes";
import { exportAttachment } from "../../utils/exportAttachment";

function readItems(node: ReactNodeViewProps["node"]): AttachmentNodeItem[] {
  const raw = node.attrs.items;
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeAttachmentItem).filter((item): item is AttachmentNodeItem => item !== null);
}

function readAlign(node: ReactNodeViewProps["node"]): AttachmentBlockAttrs["align"] {
  const value = node.attrs.align;
  return value === "center" || value === "right" ? value : "left";
}

/** 附件块 NodeView：卡片/长条、组级对齐、逐项下载与移除。 */
export function AttachmentBlockNodeView(props: ReactNodeViewProps) {
  const { node, selected, updateAttributes, deleteNode, editor } = props;
  const options = props.extension.options as unknown as AttachmentNodeViewOptions;
  const items = readItems(node);
  const align = readAlign(node);
  const variant: AttachmentBlockAttrs["variant"] = node.attrs.variant === "list" ? "list" : "grid";
  const [activeIndex, setActiveIndex] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [activeIndex, items.length]);

  const selectBlock = useCallback(
    (index: number) => {
      setActiveIndex(index);
      const pos = typeof props.getPos === "function" ? props.getPos() : undefined;
      if (typeof pos === "number") editor.commands.setNodeSelection(pos);
    },
    [editor, props],
  );

  const downloadItem = useCallback(
    async (item: AttachmentNodeItem) => {
      if (busyKey) return;
      // 忙碌态按项而非按附件计：同一附件被引用两次时只转当前那一颗。
      setBusyKey(item.uid ?? item.attachmentId);
      try {
        await exportAttachment(item.attachmentId, item.name, options.onError);
      } finally {
        setBusyKey(null);
      }
    },
    [busyKey, options],
  );

  const removeItem = (index: number) => {
    const next = items.filter((_, itemIndex) => itemIndex !== index);
    if (next.length === 0) {
      deleteNode();
      return;
    }
    updateAttributes({ items: next });
    setActiveIndex(Math.min(index, next.length - 1));
  };

  const setAlign = (next: AttachmentBlockAttrs["align"]) => updateAttributes({ align: next });
  const setVariant = (next: AttachmentBlockAttrs["variant"]) => updateAttributes({ variant: next });

  return (
    <NodeViewWrapper
      className={cn("attachment-block", selected && "is-selected")}
      data-variant={variant}
      data-align={align}
      data-selected={selected}
      contentEditable={false}
    >
      <div className="attachment-block-shell">
        {selected && (
          <div
            className="attachment-block-toolbar"
            role="toolbar"
            aria-label="附件布局"
            data-visible="true"
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "left"}
              aria-label="附件左对齐"
              title="左对齐"
              onClick={() => setAlign("left")}
            >
              <AlignLeft className="size-3.5" />
            </button>
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "center"}
              aria-label="附件居中"
              title="居中"
              onClick={() => setAlign("center")}
            >
              <AlignCenter className="size-3.5" />
            </button>
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={align === "right"}
              aria-label="附件右对齐"
              title="右对齐"
              onClick={() => setAlign("right")}
            >
              <AlignRight className="size-3.5" />
            </button>
            <span className="attachment-toolbar__divider" aria-hidden="true" />
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={variant === "grid"}
              aria-label="卡片布局"
              title="卡片布局"
              onClick={() => setVariant("grid")}
            >
              <LayoutGrid className="size-3.5" />
            </button>
            <button
              type="button"
              className="attachment-toolbar__button"
              data-active={variant === "list"}
              aria-label="长条布局"
              title="长条布局"
              onClick={() => setVariant("list")}
            >
              <Rows3 className="size-3.5" />
            </button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="attachment-block-empty">附件不可用</div>
        ) : (
          <div className="attachment-block-items" data-variant={variant}>
            {items.map((item, index) => (
              <div
                key={item.uid ?? item.attachmentId}
                className="attachment-item"
                data-variant={variant}
                data-selected={selected && activeIndex === index}
              >
                <button
                  type="button"
                  className="attachment-item__select"
                  aria-label={`选择附件 ${item.name}`}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    selectBlock(index);
                  }}
                >
                  <FileTypeIcon
                    fileName={item.name}
                    mime={item.mime}
                    size={variant === "grid" ? "card" : "row"}
                  />
                  <div className="attachment-item__text">
                    <span className="attachment-item__name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="attachment-item__meta">{formatAttachmentBytes(item.size)}</span>
                  </div>
                </button>
                <div className="attachment-item__actions">
                  <button
                    type="button"
                    className="attachment-item__action"
                    aria-label={`下载 ${item.name}`}
                    title="下载"
                    disabled={busyKey !== null}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void downloadItem(item)}
                  >
                    {busyKey === (item.uid ?? item.attachmentId) ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="attachment-item__action"
                    aria-label={`移除附件 ${item.name}`}
                    title="移除"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => removeItem(index)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
