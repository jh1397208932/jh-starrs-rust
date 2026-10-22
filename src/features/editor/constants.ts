/** 编辑器色板：全部引用设计令牌，主题切换时颜色随变量联动。 */

export interface ColorOption {
  label: string;
  value: string;
}

export const TEXT_COLORS: ColorOption[] = [
  { label: "墨色", value: "var(--foreground)" },
  { label: "次要文字", value: "var(--muted-foreground)" },
  { label: "主题色", value: "var(--primary)" },
  { label: "强调色", value: "var(--accent-foreground)" },
  { label: "危险色", value: "var(--destructive)" },
];

export const HIGHLIGHT_COLORS: ColorOption[] = [
  {
    label: "琥珀高亮",
    value: "color-mix(in srgb, var(--primary) 22%, transparent)",
  },
  {
    label: "星金高亮",
    value: "color-mix(in srgb, var(--accent) 42%, transparent)",
  },
  {
    label: "纸张高亮",
    value: "var(--muted)",
  },
  {
    label: "警示高亮",
    value: "color-mix(in srgb, var(--destructive) 18%, transparent)",
  },
];
