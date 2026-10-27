/**
 * 标记（图标）渲染映射：XMind 语义的标记 id → 可辨识的图形与中文名。
 *
 * 优先级用彩色数字徽标，进度用 `N/6`，星期/月份用中文文本，
 * 其余用 lucide 线形图标；`label` 供 tooltip 与悬停卡展示。
 */

export type MarkerKind =
  | "priority"
  | "progress"
  | "flag"
  | "star"
  | "check"
  | "cross"
  | "question"
  | "exclamation"
  | "plus"
  | "minus"
  | "face"
  | "week"
  | "month";

export interface MindmapMarkerIcon {
  id: string;
  kind: MarkerKind;
  color: string;
  /** 节点内显示的短文本（数字/星期/月份/进度） */
  text?: string;
  /** 中文全名，用于 tooltip 与悬停卡 */
  label: string;
}

const PRIORITY_COLORS = ["#c0554e", "#e8873a", "#b08a55", "#5c8f83", "#5b8fb5", "#7c82b8"];
const DAY_NAMES: Record<string, { text: string; label: string }> = {
  mon: { text: "周一", label: "星期一" },
  tue: { text: "周二", label: "星期二" },
  wed: { text: "周三", label: "星期三" },
  thu: { text: "周四", label: "星期四" },
  fri: { text: "周五", label: "星期五" },
  sat: { text: "周六", label: "星期六" },
  sun: { text: "日", label: "星期日" },
};
const FLAG_LABELS: Record<string, string> = {
  red: "旗标（红）",
  orange: "旗标（橙）",
  green: "旗标（绿）",
  blue: "旗标（蓝）",
  purple: "旗标（紫）",
};
const FACE_LABELS: Record<string, { text: string; label: string }> = {
  smile: { text: ":)", label: "表情（微笑）" },
  grin: { text: ":D", label: "表情（大笑）" },
  neutral: { text: ":|", label: "表情（平静）" },
  frown: { text: ":(", label: "表情（难过）" },
  angry: { text: ">:", label: "表情（生气）" },
};
const SYMBOLS: Record<string, { kind: MarkerKind; color: string; label: string }> = {
  "symbol-check": { kind: "check", color: "#5c8f83", label: "符号（完成）" },
  "symbol-cross": { kind: "cross", color: "#c0554e", label: "符号（取消）" },
  "symbol-question": { kind: "question", color: "#b08a55", label: "符号（疑问）" },
  "symbol-exclamation": { kind: "exclamation", color: "#e8873a", label: "符号（警示）" },
  "symbol-plus": { kind: "plus", color: "#5c8f83", label: "符号（加）" },
  "symbol-minus": { kind: "minus", color: "#626663", label: "符号（减）" },
};

/** 标记 id → 渲染描述；未知 id 返回 null（后端白名单外的标记不会出现）。 */
export function markerBadge(id: string): MindmapMarkerIcon | null {
  if (id.startsWith("priority-")) {
    const index = Number(id.slice("priority-".length));
    return {
      id,
      kind: "priority",
      text: String(index),
      color: PRIORITY_COLORS[index - 1] ?? "#626663",
      label: `优先级 ${index}`,
    };
  }
  if (id.startsWith("progress-")) {
    const value = Number(id.slice("progress-".length));
    return {
      id,
      kind: "progress",
      text: `${value}/6`,
      color: "#5b8fb5",
      label: `任务进度 ${value}/6`,
    };
  }
  if (id === "flag") return { id, kind: "flag", color: "#5c8f83", label: "旗标" };
  if (id.startsWith("flag-")) {
    const tone = id.slice("flag-".length);
    const colors: Record<string, string> = {
      red: "#c0554e",
      orange: "#e8873a",
      green: "#5c8f83",
      blue: "#5b8fb5",
      purple: "#7c82b8",
    };
    return {
      id,
      kind: "flag",
      color: colors[tone] ?? "#5c8f83",
      label: FLAG_LABELS[tone] ?? "旗标",
    };
  }
  if (id === "star") return { id, kind: "star", color: "#b08a55", label: "星标" };
  const symbol = SYMBOLS[id];
  if (symbol) return { id, kind: symbol.kind, color: symbol.color, label: symbol.label };
  if (id.startsWith("face-")) {
    const face = FACE_LABELS[id.slice("face-".length)];
    if (!face) return null;
    return { id, kind: "face", text: face.text, color: "#5c8f83", label: face.label };
  }
  if (id.startsWith("week-")) {
    const day = DAY_NAMES[id.slice("week-".length)];
    if (!day) return null;
    return { id, kind: "week", text: day.text, color: "#626663", label: day.label };
  }
  if (id.startsWith("month-")) {
    const month = Number(id.slice("month-".length));
    return { id, kind: "month", text: `${month}月`, color: "#626663", label: `${month} 月` };
  }
  return null;
}

/** 标记中文名（悬停卡与 tooltip 共用）。 */
export function markerLabel(id: string): string {
  return markerBadge(id)?.label ?? id;
}
