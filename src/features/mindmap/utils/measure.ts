/**
 * 主题尺寸测量。
 *
 * 布局只依赖这里的测量结果；React Flow 节点 CSS 必须使用同一组常量，避免画面与导出错位。
 * 测量用隐藏 span 读真实排版（字重与 CSS 一致：根 700、其余 400），再留 2px 余量，
 * 否则画布文字会在测量宽度刚好等于渲染宽度时被折行（2026-10-26 真机现场）。
 */

import type { MindmapTopic } from "@/types/mindmap";

export const TOPIC_LINE_HEIGHT = 20;
export const TOPIC_PADDING_X = 12;
export const TOPIC_PADDING_Y = 8;
export const TOPIC_MAX_TEXT_WIDTH = 300;
export const TOPIC_MIN_WIDTH = 80;
const TOPIC_SAFETY_X = 8;
/** 非根主题文本宽度上限：比旧版更宽，减少长内容被过早折行。 */
const TOPIC_TEXT_WIDTH = 240;
/** 元信息行与 CSS 保持一致：chip 高 15、间距 4、与正文间距 2。 */
const META_CHIP_HEIGHT = 15;
const META_GAP = 4;
const META_CONTENT_GAP = 2;

let probe: HTMLSpanElement | null = null;
let cachedFamily: string | null = null;
const cache = new Map<string, { width: number; height: number }>();

/** 按主题内容计算尺寸。 */
export function measureTopic(topic: MindmapTopic, isRoot: boolean): { width: number; height: number } {
  const metaWidths = metaChipWidths(topic);
  const metaCount = metaWidths.length;
  const key = `${topic.id}|${isRoot ? "r" : "n"}|${topic.text}|${(topic.labels ?? []).join("\u0001")}|${topic.markers?.length ?? 0}|${topic.stickers?.length ?? 0}|${topic.note ? 1 : 0}|${topic.link ? 1 : 0}|${topic.image ? `${topic.image.width}x${topic.image.height}` : ""}`;
  const cached = cache.get(key);
  if (cached) return { width: cached.width, height: cached.height };
  const maxTextWidth = isRoot ? TOPIC_MAX_TEXT_WIDTH : TOPIC_TEXT_WIDTH;
  const lines = wrapText(topic.text || " ", maxTextWidth);
  const textWidth = Math.max(...lines.map((line) => measureText(line, isRoot ? 700 : 400)));
  let width = Math.max(
    TOPIC_MIN_WIDTH,
    Math.min(maxTextWidth, Math.ceil(textWidth)) + TOPIC_PADDING_X * 2 + TOPIC_SAFETY_X,
  );
  // 元信息只能整体换行；宽度不足以放下首行时会溢出节点（曾把标题顶出画布）。
  if (metaCount > 0) {
    const totalMeta = metaWidths.reduce((sum, item) => sum + item, 0) + META_GAP * (metaCount - 1);
    width = Math.max(width, Math.min(maxTextWidth, totalMeta) + TOPIC_PADDING_X * 2 + TOPIC_SAFETY_X);
  }
  let height = lines.length * TOPIC_LINE_HEIGHT + TOPIC_PADDING_Y * 2;
  if (topic.image) {
    width = Math.max(width, Math.min(320, topic.image.width) + TOPIC_PADDING_X * 2);
    height += Math.min(180, topic.image.height) + 8;
  }
  if (metaCount > 0) {
    // 内宽要扣掉左右内边距与边框；再留 2px 余量，宁可多一行也不让 chip 溢出。
    const rows = metaRowCount(metaWidths, width - TOPIC_PADDING_X * 2 - 2);
    height += META_CONTENT_GAP + rows * META_CHIP_HEIGHT + (rows - 1) * META_GAP + META_GAP;
  }
  const value = { width, height };
  if (cache.size >= 50_000) cache.clear();
  cache.set(key, value);
  return { width: value.width, height: value.height };
}

/** 获取文本换行结果，供 SVG 导出复用。 */
export function topicLines(topic: MindmapTopic, isRoot: boolean): string[] {
  measureTopic(topic, isRoot);
  const maxTextWidth = isRoot ? TOPIC_MAX_TEXT_WIDTH : TOPIC_TEXT_WIDTH;
  return wrapText(topic.text || " ", maxTextWidth);
}

/** 估算元信息 chip 宽度（与 CSS 的 10px/500 字重一致）。 */
function metaChipWidths(topic: MindmapTopic): number[] {
  const widths: number[] = [];
  for (let index = 0; index < (topic.stickers?.length ?? 0); index += 1) widths.push(16);
  for (const marker of topic.markers ?? []) {
    if (marker.startsWith("priority-")) widths.push(16);
    else if (marker.startsWith("progress-")) widths.push(28);
    else if (marker.startsWith("week-") || marker.startsWith("month-")) widths.push(20);
    else if (marker.startsWith("face-")) widths.push(22);
    else widths.push(14);
  }
  for (const label of topic.labels ?? []) widths.push(measureMetaText(`#${label}`) + 12);
  // 备注/链接 chip 文案随语言变化，用固定估算并留余量。
  if (topic.note) widths.push(62);
  if (topic.link) widths.push(84);
  return widths;
}

/** 元信息按可用内宽折行后的行数。 */
function metaRowCount(widths: number[], innerWidth: number): number {
  let rows = 1;
  let rowWidth = 0;
  for (const item of widths) {
    if (rowWidth === 0) {
      rowWidth = item;
    } else if (rowWidth + META_GAP + item <= innerWidth) {
      rowWidth += META_GAP + item;
    } else {
      rows += 1;
      rowWidth = item;
    }
  }
  return rows;
}

/** 按 10px/500 测量 chip 文本，避免标签把节点撑爆。 */
function measureMetaText(value: string): number {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;letter-spacing:normal;";
    document.body.appendChild(probe);
  }
  probe.style.font = `500 10px ${resolveFamily()}`;
  probe.textContent = value;
  return probe.offsetWidth;
}

/** 清空字体/主题变化后的测量缓存。 */
export function clearMeasureCache(): void {
  cache.clear();
  cachedFamily = null;
}

function measureText(value: string, weight: number): number {
  if (!probe) {
    probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;letter-spacing:normal;";
    document.body.appendChild(probe);
  }
  probe.style.font = `${weight} 14px ${resolveFamily()}`;
  probe.textContent = value;
  return probe.offsetWidth;
}

function resolveFamily(): string {
  if (cachedFamily === null) {
    try {
      cachedFamily = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    } catch {
      cachedFamily = "system-ui, sans-serif";
    }
  }
  return cachedFamily;
}

function wrapText(value: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let current = "";
    for (const token of splitTokens(paragraph)) {
      const candidate = current + token;
      if (!current || measureText(candidate, 400) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = token.trimStart();
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [" "];
}

function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  let word = "";
  for (const character of value) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、]/u.test(character)) {
      if (word) {
        tokens.push(word);
        word = "";
      }
      tokens.push(character);
    } else if (character === " ") {
      word += character;
      tokens.push(word);
      word = "";
    } else {
      word += character;
    }
  }
  if (word) tokens.push(word);
  return tokens;
}
