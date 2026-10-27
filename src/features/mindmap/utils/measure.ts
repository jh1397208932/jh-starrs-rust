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
export const TOPIC_MAX_TEXT_WIDTH = 220;
export const TOPIC_MIN_WIDTH = 72;
export const TOPIC_META_HEIGHT = 18;
const TOPIC_SAFETY_X = 8;

let probe: HTMLSpanElement | null = null;
let cachedFamily: string | null = null;
const cache = new Map<string, { width: number; height: number; lines: string[] }>();

/** 按主题内容计算尺寸。 */
export function measureTopic(topic: MindmapTopic, isRoot: boolean): { width: number; height: number } {
  const key = `${topic.id}|${isRoot ? "r" : "n"}|${topic.text}|${topic.labels?.length ?? 0}|${topic.markers?.length ?? 0}|${topic.image ? `${topic.image.width}x${topic.image.height}` : ""}`;
  const cached = cache.get(key);
  if (cached) return { width: cached.width, height: cached.height };
  const maxTextWidth = isRoot ? TOPIC_MAX_TEXT_WIDTH : 180;
  const lines = wrapText(topic.text || " ", maxTextWidth);
  const textWidth = Math.max(...lines.map((line) => measureText(line, isRoot ? 700 : 400)));
  let width = Math.max(
    TOPIC_MIN_WIDTH,
    Math.min(maxTextWidth, Math.ceil(textWidth)) + TOPIC_PADDING_X * 2 + TOPIC_SAFETY_X,
  );
  let height = lines.length * TOPIC_LINE_HEIGHT + TOPIC_PADDING_Y * 2;
  if (topic.image) {
    width = Math.max(width, Math.min(320, topic.image.width) + TOPIC_PADDING_X * 2);
    height += Math.min(180, topic.image.height) + 8;
  }
  if ((topic.labels?.length ?? 0) > 0 || (topic.markers?.length ?? 0) > 0) {
    height += TOPIC_META_HEIGHT;
  }
  const value = { width, height, lines };
  if (cache.size >= 50_000) cache.clear();
  cache.set(key, value);
  return { width: value.width, height: value.height };
}

/** 获取文本换行结果，供 SVG 导出复用。 */
export function topicLines(topic: MindmapTopic, isRoot: boolean): string[] {
  measureTopic(topic, isRoot);
  const maxTextWidth = isRoot ? TOPIC_MAX_TEXT_WIDTH : 180;
  return wrapText(topic.text || " ", maxTextWidth);
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
