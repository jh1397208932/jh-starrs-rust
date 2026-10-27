/**
 * 标记（图标）渲染映射：XMind 语义的标记 id → 小图标。
 *
 * 图标用 lucide 线形 + 语义色，星期/月份/进度用等宽字符，避免引入位图资产。
 */

export interface MindmapMarkerIcon {
  id: string;
  icon: "star" | "flag" | "check" | "cross" | "question" | "exclamation" | "plus" | "minus" | "face" | "text";
  color?: string;
  text?: string;
}

const PRIORITY_COLORS = ["#c0554e", "#e07a5f", "#b08a55", "#5c8f83", "#5b8fb5", "#7c82b8"];
const WEEK_TEXT = ["一", "二", "三", "四", "五", "六", "日"];

/** 标记 id → 渲染描述；未知 id 返回 null（后端白名单外的标记不会出现）。 */
export function markerBadge(id: string): MindmapMarkerIcon | null {
  if (id.startsWith("priority-")) {
    const index = Number(id.slice("priority-".length));
    return { id, icon: "text", text: String(index), color: PRIORITY_COLORS[index - 1] };
  }
  if (id.startsWith("progress-")) {
    return { id, icon: "text", text: id.slice("progress-".length), color: "#5b8fb5" };
  }
  if (id === "flag") return { id, icon: "flag", color: "#5c8f83" };
  if (id.startsWith("flag-")) {
    const tone = id.slice("flag-".length);
    const colors: Record<string, string> = {
      red: "#c0554e",
      orange: "#e07a5f",
      green: "#5c8f83",
      blue: "#5b8fb5",
      purple: "#7c82b8",
    };
    return { id, icon: "flag", color: colors[tone] };
  }
  if (id === "star") return { id, icon: "star", color: "#b08a55" };
  if (id === "symbol-check") return { id, icon: "check", color: "#5c8f83" };
  if (id === "symbol-cross") return { id, icon: "cross", color: "#c0554e" };
  if (id === "symbol-question") return { id, icon: "question", color: "#b08a55" };
  if (id === "symbol-exclamation") return { id, icon: "exclamation", color: "#e07a5f" };
  if (id === "symbol-plus") return { id, icon: "plus", color: "#5c8f83" };
  if (id === "symbol-minus") return { id, icon: "minus", color: "#626663" };
  if (id.startsWith("face-")) {
    const tones: Record<string, string> = {
      smile: "#5c8f83",
      grin: "#b08a55",
      neutral: "#626663",
      frown: "#e07a5f",
      angry: "#c0554e",
    };
    return { id, icon: "face", color: tones[id.slice("face-".length)] };
  }
  if (id.startsWith("week-")) {
    const index = Number(id.slice("week-".length)) - 1;
    return { id, icon: "text", text: WEEK_TEXT[index] ?? "", color: "#626663" };
  }
  if (id.startsWith("month-")) {
    return { id, icon: "text", text: id.slice("month-".length), color: "#626663" };
  }
  return null;
}
