/**
 * 大纲缩进烟雾测试（Node 运行，无需窗口）。
 *
 * 需求：层级再深，行内容与右侧动作按钮都必须留在 300px 面板内。
 * 历史缺陷是缩进按 `6 + 深度*14` 无上限增长，深度 20 之后整行被推出面板且没有横向滚动条。
 */

import {
  OUTLINE_MAX_INDENT_DEPTH,
  OUTLINE_INDENT_BASE,
  OUTLINE_INDENT_STEP,
  outlineIndent,
} from "@/features/mindmap/utils/outlineIndent";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

/** 面板固定宽 300px；去掉左右内边距 12、行右内边距 6、动作按钮 40、文本最小可读宽 80。 */
const TEXT_BUDGET = 300 - 12 - 6 - 40 - 80;

assert(outlineIndent(0) === OUTLINE_INDENT_BASE, `根行只留基础内边距（实际 ${outlineIndent(0)}）`);
assert(
  outlineIndent(OUTLINE_MAX_INDENT_DEPTH) ===
    OUTLINE_INDENT_BASE + OUTLINE_MAX_INDENT_DEPTH * OUTLINE_INDENT_STEP,
  "封顶层级仍按每级步进缩进",
);
assert(
  outlineIndent(64) === outlineIndent(OUTLINE_MAX_INDENT_DEPTH),
  `第 64 层与封顶层缩进一致（实际 ${outlineIndent(64)}）`,
);
assert(outlineIndent(-3) === OUTLINE_INDENT_BASE, "负数层级按 0 处理");

let previous = -1;
for (let depth = 0; depth <= 200; depth += 1) {
  const indent = outlineIndent(depth);
  assert(indent >= previous, `第 ${depth} 层缩进不倒退（${indent} ≥ ${previous}）`);
  assert(indent <= TEXT_BUDGET, `第 ${depth} 层缩进为文本留出可读宽度（${indent} ≤ ${TEXT_BUDGET}）`);
  previous = indent;
}

console.log("大纲缩进烟雾测试通过");
