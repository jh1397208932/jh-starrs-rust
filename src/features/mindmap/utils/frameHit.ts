/**
 * 外框 / 概要的几何命中选择。
 *
 * 画布上的外框与括号是 `pointer-events: none` 的装饰层；用户点在它们的空白处时，
 * React Flow 只会派发 pane 点击。这里用流坐标做命中测试，让检查器里的标签/颜色/删除可达。
 */

import type { MindmapLayout } from "@/types/mindmap";

interface Point {
  x: number;
  y: number;
}

/** 返回命中的外框或概要 id；都没有命中返回 null。 */
export function hitTestFrame(layout: MindmapLayout, point: Point): string | null {
  // 概要括号更薄且可能叠在外框边缘：优先判定。
  for (const summary of layout.summaries) {
    if (insideRect(summary, point, 6)) return summary.id;
  }
  for (const boundary of layout.boundaries) {
    if (insideRect(boundary, point, 4)) return boundary.id;
  }
  return null;
}

function insideRect(
  rect: { x: number; y: number; width: number; height: number },
  point: Point,
  padding: number,
): boolean {
  return (
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.height + padding
  );
}
