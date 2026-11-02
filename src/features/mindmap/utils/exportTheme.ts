/**
 * 思维导图导出的主题读数：与画布同一套 CSS 令牌，导出与内嵌预览共用。
 */

export interface MindmapExportTheme {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  branches: string[];
}

/** 从根元素读取当前主题；缺省回落到中性色。 */
export function readMindmapExportTheme(): MindmapExportTheme {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--background", "#ffffff"),
    card: read("--card", "#ffffff"),
    foreground: read("--foreground", "#1d201f"),
    muted: read("--muted-foreground", "#626663"),
    border: read("--border", "#d7e0dc"),
    branches: [0, 1, 2, 3, 4, 5].map((index) => read(`--mindmap-branch-${index}`, "#888888")),
  };
}
