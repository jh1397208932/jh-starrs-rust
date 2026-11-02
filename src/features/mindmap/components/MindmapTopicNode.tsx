import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";
import { NodeHoverCard, NodeMeta } from "./MindmapNodeMeta";
import type { MindmapMarkerIcon } from "./markerIcons";
import { markerBadge } from "./markerIcons";

export interface MindmapNodeData extends Record<string, unknown> {
  topic: MindmapTopic;
  isRoot: boolean;
  depth: number;
  side: "root" | "left" | "right" | "down";
  editing: boolean;
  hiddenCount: number;
  branchIndex: number;
  number?: string;
  free?: boolean;
  imageUrl?: string;
  onCommitText: (id: string, text: string) => void;
  onStartEdit: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
}

/** 单个主题节点外壳：编辑态、折叠徽标、连接点与悬停入口。 */
export function MindmapTopicNode({
  id,
  data,
  selected,
}: NodeProps & { data: MindmapNodeData; selected?: boolean }) {
  const { t } = useI18n();
  const { topic, isRoot, depth, side, editing, hiddenCount, branchIndex, number, free, imageUrl } = data;
  const [draft, setDraft] = useState(topic.text);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);
  const style = topic.style ?? null;
  const branchColor = `var(--mindmap-branch-${branchIndex % 6})`;
  const borderColor = style?.borderColor && style.borderColor !== "auto" ? style.borderColor : branchColor;
  const fill =
    style?.fill && style.fill !== "auto" && style.fill !== "none"
      ? `${style.fill}26`
      : style?.fill === "none"
        ? "transparent"
        : undefined;
  const shape = style?.borderShape ?? "rounded";
  const badges = (topic.markers ?? [])
    .map(markerBadge)
    .filter((badge): badge is MindmapMarkerIcon => Boolean(badge));
  const hasMeta =
    (topic.stickers?.length ?? 0) +
      badges.length +
      (topic.labels?.length ?? 0) +
      (topic.note ? 1 : 0) +
      (topic.link ? 1 : 0) >
    0;
  const hasHoverInfo = Boolean(topic.note || topic.labels?.length || badges.length || topic.link);

  useEffect(() => {
    if (!editing) setDraft(topic.text);
  }, [editing, topic.text]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(
    () => () => {
      if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    },
    [],
  );

  const commit = () => {
    if (!editing) return;
    data.onCommitText(id, draft.replace(/\s+$/u, ""));
  };

  const showHover = () => {
    if (!hasHoverInfo || editing) return;
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => setHovered(true), 160);
  };
  const hideHover = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    setHovered(false);
  };
  const cancelHide = () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  };
  const scheduleHide = () => {
    cancelHide();
    hoverTimerRef.current = window.setTimeout(() => setHovered(false), 140);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬停卡是辅助信息；节点内含链接按钮，外层不能是原生 button
    <div
      className={[
        "mindmap-node",
        isRoot ? "mindmap-node--root" : "",
        selected ? "is-selected" : "",
        editing ? "is-editing" : "",
        style ? "is-styled" : "",
        hovered ? "is-hovered" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-side={side}
      data-depth={depth}
      data-free={free ? "true" : undefined}
      data-shape={shape}
      data-width={style?.borderWidth ?? "normal"}
      style={
        {
          width: "100%",
          height: "100%",
          "--branch-color": borderColor,
          ...(style?.borderColor && style.borderColor !== "auto" ? { borderColor: style.borderColor } : {}),
          ...(fill ? { background: fill } : {}),
        } as CSSProperties
      }
      onMouseEnter={showHover}
      onMouseLeave={scheduleHide}
    >
      {editing ? (
        <textarea
          ref={inputRef}
          className="mindmap-node__editor"
          value={draft}
          rows={1}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (composingRef.current) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(topic.text);
              data.onCommitText(id, topic.text);
            }
            event.stopPropagation();
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="mindmap-node__content"
            onDoubleClick={(event) => {
              event.stopPropagation();
              data.onStartEdit(id);
            }}
            onFocus={showHover}
            onBlur={hideHover}
          >
            {imageUrl ? <img className="mindmap-node__image" src={imageUrl} alt={topic.text} /> : null}
            <span className="mindmap-node__title">
              {number ? <span className="mindmap-node__number">{number}</span> : null}
              <span className={topic.text ? "mindmap-node__text" : "mindmap-node__text is-empty"}>
                {topic.text || t("无标题主题")}
              </span>
            </span>
          </button>
          {hasMeta ? <NodeMeta topic={topic} badges={badges} /> : null}
        </>
      )}
      {hovered ? (
        <NodeHoverCard topic={topic} badges={badges} onKeepOpen={cancelHide} onClose={hideHover} />
      ) : null}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mindmap-node__collapse"
          style={{ borderColor }}
          aria-label={`${topic.collapsed ? t("展开") : t("折叠")} ${hiddenCount}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapsed(id);
          }}
        >
          {hiddenCount}
        </button>
      ) : null}
    </div>
  );
}
