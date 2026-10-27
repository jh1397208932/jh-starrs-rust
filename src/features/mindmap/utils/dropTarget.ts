/**
 * 拖拽落点判定：换父 / 同父排序 / 自由摆放。
 *
 * 纯函数，便于单独测试；画布只负责收集命中集合与坐标。
 */

import type { MindmapContent, MindmapLayout, MindmapTopic } from "@/types/mindmap";

export type DropDecision =
  | { kind: "reparent"; targetId: string }
  | { kind: "freeAttach"; targetId: string }
  | { kind: "reorder"; index: number }
  | { kind: "move"; position: { x: number; y: number } };

/** 在树中按 id 查主题。 */
export function findTopicById(topic: MindmapTopic, id: string): MindmapTopic | null {
  if (topic.id === id) return topic;
  for (const child of topic.children ?? []) {
    const found = findTopicById(child, id);
    if (found) return found;
  }
  return null;
}

/** 返回父主题 id；根主题返回 null。 */
export function parentOfTopic(content: MindmapContent, id: string): string | null {
  const walk = (topic: MindmapTopic): string | null => {
    for (const child of topic.children ?? []) {
      if (child.id === id) return topic.id;
      const nested = walk(child);
      if (nested) return nested;
    }
    return null;
  };
  return walk(content.sheet.root);
}

/** candidate 是否为 ancestor 的后代（避免把父拖进自己的子树）。 */
export function isDescendant(content: MindmapContent, ancestorId: string, candidateId: string): boolean {
  const ancestor = findTopicById(content.sheet.root, ancestorId);
  return Boolean(ancestor && findTopicById(ancestor, candidateId));
}

export interface ResolveDropParams {
  content: MindmapContent;
  layoutNodes: MindmapLayout["nodes"];
  draggedId: string;
  draggedPosition: { x: number; y: number };
  /** 拖拽期间与之相交的节点 id */
  intersectingIds: string[];
}

/** 依次判定：换父 → 同父排序 → 自由摆放。 */
export function resolveDrop(params: ResolveDropParams): DropDecision {
  const { content, layoutNodes, draggedId, draggedPosition, intersectingIds } = params;
  const isFree = (content.freeTopics ?? []).some((topic) => topic.id === draggedId);
  const target = intersectingIds.find((id) => id !== draggedId && !isDescendant(content, draggedId, id));
  if (target) {
    return isFree ? { kind: "freeAttach", targetId: target } : { kind: "reparent", targetId: target };
  }
  const parentId = parentOfTopic(content, draggedId);
  const draggedNode = layoutNodes.find((node) => node.id === draggedId);
  if (parentId && !isFree && draggedNode) {
    const siblings = (findTopicById(content.sheet.root, parentId)?.children ?? [])
      .map((child, index) => ({ id: child.id, index }))
      .filter((item) => item.id !== draggedId);
    const centerX = draggedPosition.x + draggedNode.width / 2;
    const centerY = draggedPosition.y + draggedNode.height / 2;
    const nearest = siblings.reduce<{ id: string; index: number; distance: number } | null>((best, item) => {
      const node = layoutNodes.find((candidate) => candidate.id === item.id);
      if (!node) return best;
      const distance = Math.hypot(node.x + node.width / 2 - centerX, node.y + node.height / 2 - centerY);
      return best && best.distance <= distance ? best : { ...item, distance };
    }, null);
    const threshold = draggedNode.width / 2 + 40;
    if (nearest && nearest.distance < threshold) {
      return { kind: "reorder", index: nearest.index };
    }
  }
  return { kind: "move", position: draggedPosition };
}
