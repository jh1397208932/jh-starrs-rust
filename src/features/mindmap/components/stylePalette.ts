/**
 * 思维导图 v2 样式常量：12 色板（与 Rust domain STYLE_PALETTE 一致）与标记分组。
 */

export const STYLE_PALETTE = [
  "#e07a5f",
  "#f2b84b",
  "#f2cc8f",
  "#81b29a",
  "#5c8f83",
  "#3d8a7e",
  "#5b8fb5",
  "#7c82b8",
  "#b06ab3",
  "#c0554e",
  "#b08a55",
  "#2f5c51",
] as const;

export interface MindmapMarkerOption {
  id: string;
  /** 显示用字符；空则显示文字 */
  glyph?: string;
  text?: string;
  color: string;
}

export interface MindmapMarkerGroup {
  label: string;
  markers: MindmapMarkerOption[];
}

const PRIORITY_COLORS = ["#c0554e", "#e07a5f", "#b08a55", "#5c8f83", "#5b8fb5", "#7c82b8"];
const WEEK_GLYPHS = ["一", "二", "三", "四", "五", "六", "日"];

export const MARKER_GROUPS: MindmapMarkerGroup[] = [
  {
    label: "优先级",
    markers: PRIORITY_COLORS.map((color, index) => ({
      id: `priority-${index + 1}`,
      text: String(index + 1),
      color,
    })),
  },
  {
    label: "任务进度",
    markers: [0, 1, 2, 3, 4, 5, 6].map((value) => ({
      id: `progress-${value}`,
      text: String(value),
      color: "#5b8fb5",
    })),
  },
  {
    label: "旗标",
    markers: [
      { id: "flag", glyph: "⚑", color: "#5c8f83" },
      { id: "flag-red", glyph: "⚑", color: "#c0554e" },
      { id: "flag-orange", glyph: "⚑", color: "#e07a5f" },
      { id: "flag-green", glyph: "⚑", color: "#5c8f83" },
      { id: "flag-blue", glyph: "⚑", color: "#5b8fb5" },
      { id: "flag-purple", glyph: "⚑", color: "#7c82b8" },
      { id: "star", glyph: "★", color: "#b08a55" },
    ],
  },
  {
    label: "符号",
    markers: [
      { id: "symbol-check", glyph: "✓", color: "#5c8f83" },
      { id: "symbol-cross", glyph: "✕", color: "#c0554e" },
      { id: "symbol-question", glyph: "?", color: "#b08a55" },
      { id: "symbol-exclamation", glyph: "!", color: "#e07a5f" },
      { id: "symbol-plus", glyph: "+", color: "#5c8f83" },
      { id: "symbol-minus", glyph: "−", color: "#626663" },
    ],
  },
  {
    label: "表情",
    markers: [
      { id: "face-smile", text: ":)", color: "#5c8f83" },
      { id: "face-grin", text: ":D", color: "#b08a55" },
      { id: "face-neutral", text: ":|", color: "#626663" },
      { id: "face-frown", text: ":(", color: "#e07a5f" },
      { id: "face-angry", text: ">:", color: "#c0554e" },
    ],
  },
  {
    label: "星期",
    markers: WEEK_GLYPHS.map((text, index) => ({
      id: `week-${["mon", "tue", "wed", "thu", "fri", "sat", "sun"][index]}`,
      text,
      color: "#626663",
    })),
  },
  {
    label: "月份",
    markers: Array.from({ length: 12 }, (_, index) => ({
      id: `month-${index + 1}`,
      text: String(index + 1),
      color: "#626663",
    })),
  },
];

/** 内置贴纸：与 Rust ALLOWED_STICKERS 对齐。 */
export const STICKER_PALETTE: { id: string; glyph: string; color: string }[] = [
  { id: "check", glyph: "✓", color: "#5c8f83" },
  { id: "idea", glyph: "✦", color: "#b08a55" },
  { id: "warning", glyph: "!", color: "#e07a5f" },
  { id: "flame", glyph: "▲", color: "#c0554e" },
  { id: "target", glyph: "◎", color: "#5b8fb5" },
  { id: "pin", glyph: "◉", color: "#7c82b8" },
  { id: "heart", glyph: "♥", color: "#c0554e" },
  { id: "thumb", glyph: "+", color: "#5c8f83" },
  { id: "burst", glyph: "✸", color: "#b08a55" },
  { id: "question", glyph: "?", color: "#626663" },
  { id: "cash", glyph: "¥", color: "#3d8a7e" },
  { id: "clock", glyph: "◔", color: "#5b8fb5" },
];
