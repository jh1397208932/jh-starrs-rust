/**
 * 大纲缩进换算：层级再深也不把行内容推出面板。
 *
 * 历史缺陷：行缩进直接按 `6 + 深度 * 14` 增长，面板宽 300px 且 `overflow: hidden`，
 * 层级超过 20 后文本尾巴、hover 动作按钮与横向滚动条全部落在面板外，既看不见也拖不到。
 * 现在超过上限只按上限缩进，真实层级由 `aria-level` 与行内 `+N` 标记表达。
 */

/** 每级缩进的像素数。 */
export const OUTLINE_INDENT_STEP = 14;
/** 行首基础内边距。 */
export const OUTLINE_INDENT_BASE = 6;
/** 缩进封顶层级：再深也只按这个层级缩进，保证动作按钮留在面板内。 */
export const OUTLINE_MAX_INDENT_DEPTH = 8;

/**
 * 计算大纲某一层的左内边距。
 * @param depth 层级（根为 0），负数按 0 处理
 * @returns 像素内边距
 * @example outlineIndent(3) // 6 + 3*14 = 48
 */
export function outlineIndent(depth: number): number {
  return OUTLINE_INDENT_BASE + Math.min(Math.max(depth, 0), OUTLINE_MAX_INDENT_DEPTH) * OUTLINE_INDENT_STEP;
}
