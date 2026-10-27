import { Handle, type NodeProps, Position } from "@xyflow/react";
import {
  AlertCircle,
  CircleCheck,
  CircleHelp,
  CircleX,
  Flag,
  Link2,
  Minus,
  Plus,
  Smile,
  Star,
  StickyNote,
  Tag,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MindmapMarkerIcon } from "./markerIcons";
import { markerBadge } from "./markerIcons";

export interface MindmapNodeData extends Record<string, unknown> {
  topic: import("@/types/mindmap").MindmapTopic;
  isRoot: boolean;
  side: "root" | "left" | "right" | "down";
  editing: boolean;
  hiddenCount: number;
  branchIndex: number;
  number?: string;
  free?: boolean;
  stickers?: string[];
  imageUrl?: string;
  onCommitText: (id: string, text: string) => void;
  onStartEdit: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
}

/** 单个主题节点；文本编辑、样式覆盖与折叠徽标在这里闭环。 */
export function MindmapTopicNode({
  id,
  data,
  selected,
}: NodeProps & { data: MindmapNodeData; selected?: boolean }) {
  const { topic, isRoot, side, editing, hiddenCount, branchIndex, number, free, imageUrl } = data;
  const [draft, setDraft] = useState(topic.text);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
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

  const commit = () => {
    if (!editing) return;
    data.onCommitText(id, draft.replace(/\s+$/u, ""));
  };

  const badges = (topic.markers ?? []).map(markerBadge).filter(Boolean) as MindmapMarkerIcon[];

  return (
    <div
      className={[
        "mindmap-node",
        isRoot ? "mindmap-node--root" : "",
        selected ? "is-selected" : "",
        editing ? "is-editing" : "",
        style ? "is-styled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-side={side}
      data-free={free ? "true" : undefined}
      data-shape={shape}
      data-width={style?.borderWidth ?? "normal"}
      style={{
        width: "100%",
        height: "100%",
        borderColor: isRoot ? undefined : borderColor,
        ...(style?.borderShape === "underline"
          ? { background: "transparent", boxShadow: "none", borderInlineWidth: 0 }
          : {}),
        ...(fill ? { background: fill } : {}),
      }}
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
        <button
          type="button"
          className="mindmap-node__content"
          onDoubleClick={(event) => {
            event.stopPropagation();
            data.onStartEdit(id);
          }}
        >
          {number ? <span className="mindmap-node__number">{number}</span> : null}
          {imageUrl ? <img className="mindmap-node__image" src={imageUrl} alt={topic.text} /> : null}
          <span className="mindmap-node__text">{topic.text || " "}</span>
          {(topic.stickers ?? []).length > 0 ? (
            <span className="mindmap-node__stickers" aria-hidden="true">
              {(topic.stickers ?? []).map((sticker) => (
                <StickerGlyph key={sticker} id={sticker} />
              ))}
            </span>
          ) : null}
          {badges.length > 0 || (topic.labels?.length ?? 0) > 0 || topic.link ? (
            <span className="mindmap-node__badges">
              {badges.map((badge) => (
                <span
                  key={badge.id}
                  className="mindmap-node__marker"
                  style={{ color: badge.color }}
                  title={badge.id}
                >
                  <BadgeIcon badge={badge} />
                </span>
              ))}
              {(topic.labels?.length ?? 0) > 0 ? (
                <span className="mindmap-node__chip" title={topic.labels?.join(", ")}>
                  <Tag size={10} />
                </span>
              ) : null}
              {topic.note ? (
                <span className="mindmap-node__chip" title={topic.note.slice(0, 40)}>
                  <StickyNote size={10} />
                </span>
              ) : null}
              {topic.link ? (
                <a
                  className="mindmap-node__chip"
                  href={topic.link}
                  target="_blank"
                  rel="noreferrer"
                  title={topic.link}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Link2 size={10} />
                </a>
              ) : null}
            </span>
          ) : null}
        </button>
      )}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="mindmap-node__collapse"
          style={{ borderColor }}
          aria-label={`${topic.collapsed ? "展开" : "折叠"} ${hiddenCount} 个主题`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapsed(id);
          }}
        >
          {hiddenCount}
        </button>
      ) : null}
      {side === "root" ? (
        <>
          <Handle id="right" type="source" position={Position.Right} isConnectable={false} />
          <Handle id="left" type="source" position={Position.Left} isConnectable={false} />
          <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
          <Handle id="up" type="source" position={Position.Top} isConnectable={false} />
        </>
      ) : side === "left" ? (
        <>
          <Handle id="right" type="target" position={Position.Right} isConnectable={false} />
          <Handle id="left" type="source" position={Position.Left} isConnectable={false} />
        </>
      ) : side === "right" ? (
        <>
          <Handle id="left" type="target" position={Position.Left} isConnectable={false} />
          <Handle id="right" type="source" position={Position.Right} isConnectable={false} />
        </>
      ) : (
        <>
          <Handle id="up" type="target" position={Position.Top} isConnectable={false} />
          <Handle id="down" type="source" position={Position.Bottom} isConnectable={false} />
        </>
      )}
    </div>
  );
}

function BadgeIcon({ badge }: { badge: MindmapMarkerIcon }) {
  const size = 12;
  switch (badge.icon) {
    case "star":
      return <Star size={size} fill="currentColor" />;
    case "flag":
      return <Flag size={size} fill="currentColor" />;
    case "check":
      return <CircleCheck size={size} />;
    case "cross":
      return <CircleX size={size} />;
    case "question":
      return <CircleHelp size={size} />;
    case "exclamation":
      return <AlertCircle size={size} />;
    case "plus":
      return <Plus size={size} strokeWidth={3} />;
    case "minus":
      return <Minus size={size} strokeWidth={3} />;
    case "face":
      return <Smile size={size} />;
    default:
      return <span className="mindmap-node__marker-text">{badge.text}</span>;
  }
}

/** 内置贴纸：线性图标 + 语义色，避免位图资产。 */
function StickerGlyph({ id }: { id: string }) {
  const map: Record<string, { color: string; glyph: string }> = {
    check: { color: "#5c8f83", glyph: "✓" },
    idea: { color: "#b08a55", glyph: "✦" },
    warning: { color: "#e07a5f", glyph: "!" },
    flame: { color: "#c0554e", glyph: "▲" },
    target: { color: "#5b8fb5", glyph: "◎" },
    pin: { color: "#7c82b8", glyph: "◉" },
    heart: { color: "#c0554e", glyph: "♥" },
    thumb: { color: "#5c8f83", glyph: "+" },
    burst: { color: "#b08a55", glyph: "✸" },
    question: { color: "#626663", glyph: "?" },
    cash: { color: "#3d8a7e", glyph: "¥" },
    clock: { color: "#5b8fb5", glyph: "◔" },
  };
  const item = map[id];
  if (!item) return null;
  return (
    <span className="mindmap-node__sticker" style={{ color: item.color }}>
      {item.glyph}
    </span>
  );
}
