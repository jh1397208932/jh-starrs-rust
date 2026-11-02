import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { requestOpenNode } from "@/features/workspace/openNode";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  NODE_PREVIEW_UPDATED_EVENT,
  type NodePreview,
  type NodePreviewUpdatedDetail,
  type PreviewKind,
} from "@/types/preview";
import { fetchNodePreview } from "../../utils/nodePreview";

type EmbedStatus = "loading" | "ready" | "missing";

type EmbedNodeViewProps = ReactNodeViewProps & { kind: PreviewKind };

/**
 * 文档内嵌预览块：只读已存 PNG，不在编辑器里渲染源场景。
 * 预览由画板/导图保存静止后导出；这里缺图只提示去打开源内容。
 */
export function EmbedPreviewNodeView({ node, selected, kind }: EmbedNodeViewProps) {
  const { t } = useI18n();
  const nodeId = typeof node.attrs.nodeId === "string" ? node.attrs.nodeId : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const kindLabel = kind === "board" ? t("画板") : t("思维导图");
  const [preview, setPreview] = useState<NodePreview | null>(null);
  const [status, setStatus] = useState<EmbedStatus>("loading");
  const aliveRef = useRef(true);
  const previewRef = useRef<NodePreview | null>(null);
  previewRef.current = preview;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!nodeId) {
      setStatus("missing");
      return;
    }
    try {
      const found = await fetchNodePreview(kind, nodeId);
      if (!aliveRef.current) return;
      if (found) {
        setPreview(found);
        setStatus("ready");
      } else if (!previewRef.current) {
        setStatus("missing");
      }
    } catch {
      if (!aliveRef.current) return;
      if (!previewRef.current) setStatus("missing");
    }
  }, [kind, nodeId]);

  useEffect(() => {
    setPreview(null);
    setStatus("loading");
    void load();
  }, [load]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<NodePreviewUpdatedDetail>).detail;
      if (detail?.kind === kind && detail.nodeId === nodeId) void load();
    };
    window.addEventListener(NODE_PREVIEW_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(NODE_PREVIEW_UPDATED_EVENT, onUpdated);
  }, [kind, nodeId, load]);

  const openSource = () => {
    if (nodeId) requestOpenNode(nodeId);
  };

  return (
    <NodeViewWrapper
      as="figure"
      className={cn("embed-preview-block", selected && "is-selected")}
      data-kind={kind}
      contentEditable={false}
    >
      <div className="embed-preview-head">
        <span className="embed-preview-kind" data-kind={kind}>
          <NodeKindIcon kind={kind} className="size-4" />
        </span>
        <span className="embed-preview-title" title={title || kindLabel}>
          {title || kindLabel}
        </span>
        {preview && (
          <span className="embed-preview-meta">
            {preview.width} × {preview.height}
          </span>
        )}
        {nodeId && (
          <button type="button" className="embed-preview-open" onClick={openSource}>
            <ExternalLink className="size-3" />
            {t("打开")}
          </button>
        )}
      </div>

      <button
        type="button"
        className="embed-preview-canvas"
        aria-label={t("打开{name}", { name: title || kindLabel })}
        onClick={openSource}
      >
        {preview ? (
          <img src={preview.dataUrl} alt={title || kindLabel} draggable={false} decoding="async" />
        ) : status === "loading" ? (
          <span className="embed-preview-skeleton" aria-live="polite">
            <Loader2 className="size-4 animate-spin" />
            {t("正在读取预览…")}
          </span>
        ) : (
          <span className="embed-preview-empty" role="alert">
            <TriangleAlert className="size-4 text-muted-foreground" />
            {t("预览尚未生成，打开源内容后会自动导出")}
          </span>
        )}
      </button>

      {preview && (
        <figcaption className="embed-preview-caption">
          {preview.stale
            ? t("预览稍旧，源内容再次保存后会更新")
            : t("预览 · 源最近更新 {time}", { time: formatTimestamp(preview.sourceUpdatedAt) })}
        </figcaption>
      )}
    </NodeViewWrapper>
  );
}

/** 画板包装：Tiptap 只传通用 props，kind 由扩展注入。 */
export function BoardEmbedNodeView(props: ReactNodeViewProps) {
  return <EmbedPreviewNodeView {...props} kind="board" />;
}

/** 思维导图包装。 */
export function MindmapEmbedNodeView(props: ReactNodeViewProps) {
  return <EmbedPreviewNodeView {...props} kind="mindmap" />;
}
