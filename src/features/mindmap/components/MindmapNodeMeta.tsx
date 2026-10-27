/**
 * 节点元信息与悬停卡：贴纸、标记徽标、标签、备注与链接入口。
 *
 * 全部内容都在节点边界内换行；悬停卡用于关闭检查器后仍能读到备注全文。
 */

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
} from "lucide-react";
import { openExternalUrl } from "@/api/external";
import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";
import type { MindmapMarkerIcon } from "./markerIcons";

export interface NodeMetaProps {
  topic: MindmapTopic;
  badges: MindmapMarkerIcon[];
}

/** 内联元信息行：顺序固定为贴纸、标记、标签、备注、链接。 */
export function NodeMeta({ topic, badges }: NodeMetaProps) {
  const { t } = useI18n();
  const stickers = topic.stickers ?? [];
  const labels = topic.labels ?? [];
  return (
    <span className="mindmap-node__meta">
      {stickers.map((sticker) => (
        <StickerGlyph key={sticker} id={sticker} />
      ))}
      {badges.map((badge) => (
        <MarkerBadge key={badge.id} badge={badge} />
      ))}
      {labels.map((label) => (
        <span key={label} className="mindmap-node__chip mindmap-node__chip--label">
          #{label}
        </span>
      ))}
      {topic.note ? (
        <span className="mindmap-node__chip" title={topic.note.slice(0, 200)}>
          <StickyNote size={10} aria-hidden="true" />
          {t("备注")}
        </span>
      ) : null}
      {topic.link ? (
        <button
          type="button"
          className="mindmap-node__chip mindmap-node__chip--link"
          title={topic.link}
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(topic.link ?? "");
          }}
        >
          <Link2 size={10} aria-hidden="true" />
          {t("打开链接")}
        </button>
      ) : null}
    </span>
  );
}

/** 悬停卡：关闭检查器后仍能读到备注、标签、链接与标记中文名。 */
export function NodeHoverCard({
  topic,
  badges,
  onKeepOpen,
  onClose,
}: {
  topic: MindmapTopic;
  badges: MindmapMarkerIcon[];
  onKeepOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const labels = topic.labels ?? [];
  return (
    <div className="mindmap-node__hovercard" role="tooltip" onMouseEnter={onKeepOpen} onMouseLeave={onClose}>
      {topic.note ? <p className="mindmap-node__hovercard-note">{topic.note}</p> : null}
      {labels.length > 0 ? (
        <div className="mindmap-node__hovercard-row">
          {labels.map((label) => (
            <span key={label} className="mindmap-node__chip mindmap-node__chip--label">
              #{label}
            </span>
          ))}
        </div>
      ) : null}
      {badges.length > 0 ? (
        <div className="mindmap-node__hovercard-row">
          {badges.map((badge) => (
            <span key={badge.id} className="mindmap-node__hovercard-marker">
              <MarkerBadge badge={badge} />
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
      {topic.link ? (
        <button
          type="button"
          className="mindmap-node__hovercard-link"
          onClick={(event) => {
            event.stopPropagation();
            void openExternalUrl(topic.link ?? "");
          }}
        >
          <Link2 size={11} aria-hidden="true" />
          {topic.link}
        </button>
      ) : null}
      {!topic.note && labels.length === 0 && badges.length === 0 && !topic.link ? (
        <span className="mindmap-node__hovercard-empty">{t("暂无备注")}</span>
      ) : null}
    </div>
  );
}

/** 标记徽标：优先级彩色数字、进度 N/6、星期/月份文本、其余图标。 */
function MarkerBadge({ badge }: { badge: MindmapMarkerIcon }) {
  if (badge.kind === "priority") {
    return (
      <span
        className="mindmap-node__marker mindmap-node__marker--priority"
        style={{ background: badge.color }}
        title={badge.label}
      >
        {badge.text}
      </span>
    );
  }
  if (badge.kind === "progress") {
    return (
      <span
        className="mindmap-node__marker mindmap-node__marker--progress"
        style={{ color: badge.color }}
        title={badge.label}
      >
        {badge.text}
      </span>
    );
  }
  if (badge.kind === "week" || badge.kind === "month" || badge.kind === "face") {
    return (
      <span
        className="mindmap-node__marker mindmap-node__marker--text"
        style={{ color: badge.color }}
        title={badge.label}
      >
        {badge.text}
      </span>
    );
  }
  return (
    <span className="mindmap-node__marker" style={{ color: badge.color }} title={badge.label}>
      <BadgeIcon badge={badge} />
    </span>
  );
}

function BadgeIcon({ badge }: { badge: MindmapMarkerIcon }) {
  const size = 12;
  switch (badge.kind) {
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
    check: { color: "#4fae6b", glyph: "✓" },
    idea: { color: "#d9a72e", glyph: "✦" },
    warning: { color: "#e8873a", glyph: "!" },
    flame: { color: "#e05f5f", glyph: "▲" },
    target: { color: "#5b8fb5", glyph: "◎" },
    pin: { color: "#7c82b8", glyph: "◉" },
    heart: { color: "#d0647f", glyph: "♥" },
    thumb: { color: "#4fae6b", glyph: "+" },
    burst: { color: "#b45aa8", glyph: "✸" },
    question: { color: "#626663", glyph: "?" },
    cash: { color: "#3d8a7e", glyph: "¥" },
    clock: { color: "#2f9e9a", glyph: "◔" },
  };
  const item = map[id];
  if (!item) return null;
  return (
    <span className="mindmap-node__sticker" style={{ color: item.color }} aria-hidden="true">
      {item.glyph}
    </span>
  );
}
