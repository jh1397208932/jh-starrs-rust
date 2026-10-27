/**
 * 思维导图方向导航。
 *
 * 按布局坐标挑目标方向上最近的邻居：主方向距离为主、垂直偏差加权。
 * 目标方向没有节点时返回 null，避免在全为无穷分时随便选中反方向的节点。
 */

import type { MindmapLayout } from "@/types/mindmap";

export type NavigationDirection = "up" | "down" | "left" | "right";

export function pickDirectionalNode(
  nodes: MindmapLayout["nodes"],
  currentId: string,
  direction: NavigationDirection,
): MindmapLayout["nodes"][number] | null {
  const current = nodes.find((node) => node.id === currentId);
  if (!current) return null;
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  let best: MindmapLayout["nodes"][number] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    if (node.id === currentId) continue;
    const dx = node.x + node.width / 2 - centerX;
    const dy = node.y + node.height / 2 - centerY;
    const score =
      direction === "right"
        ? dx > 0
          ? Math.abs(dy) * 2 + dx
          : Number.POSITIVE_INFINITY
        : direction === "left"
          ? dx < 0
            ? Math.abs(dy) * 2 - dx
            : Number.POSITIVE_INFINITY
          : direction === "down"
            ? dy > 0
              ? Math.abs(dx) * 2 + dy
              : Number.POSITIVE_INFINITY
            : dy < 0
              ? Math.abs(dx) * 2 - dy
              : Number.POSITIVE_INFINITY;
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}
