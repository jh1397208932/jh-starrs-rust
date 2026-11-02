/**
 * 思维导图样式常量：32 色板（与 Rust domain STYLE_PALETTE 一致）与标记分组。
 *
 * 色板独立于全局主题，8×4 网格；与 Rust `domain` 的 STYLE_PALETTE 保持一致。
 */

export const STYLE_PALETTE = [
  "#e05f5f",
  "#e8873a",
  "#d9a72e",
  "#c9a227",
  "#7fa63c",
  "#4fae6b",
  "#3d8a7e",
  "#2f9e9a",
  "#5b8fb5",
  "#4f7fd9",
  "#7c82b8",
  "#8e5fb5",
  "#b45aa8",
  "#d0647f",
  "#c0554e",
  "#a87a4a",
  "#8a6a4f",
  "#2f5c51",
  "#5c8f83",
  "#81b29a",
  "#b08a55",
  "#7fb0d6",
  "#64906f",
  "#626663",
  "#e07a5f",
  "#f2b84b",
  "#f2cc8f",
  "#b06ab3",
  "#6b8e23",
  "#4682b4",
  "#cd5c5c",
  "#9370db",
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
