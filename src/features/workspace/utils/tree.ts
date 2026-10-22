import type { NodeItem, TreeDropTarget, TreeNode } from "@/types/notebook";

/**
 * 由平表节点组装递归树：按 `parentId` 归组，按 `sortOrder` 排序。
 * 父节点缺失的孤儿节点会提升为根，避免数据异常时整棵树消失。
 * @param nodes 同一知识库的全部节点
 * @returns 已排序的递归树
 * @example const tree = buildTree(await listNodes(kb.id));
 */
export function buildTree(nodes: NodeItem[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const node of nodes) map.set(node.id, { node, children: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes) {
    const treeNode = map.get(node.id);
    if (!treeNode) continue;
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(treeNode);
    else roots.push(treeNode);
  }
  sortTree(roots);
  return roots;
}

/** 递归按 sortOrder、createdAt 排序；就地修改传入数组。 */
function sortTree(entries: TreeNode[]) {
  entries.sort(
    (left, right) =>
      left.node.sortOrder - right.node.sortOrder ||
      left.node.createdAt - right.node.createdAt ||
      left.node.id.localeCompare(right.node.id),
  );
  for (const entry of entries) sortTree(entry.children);
}

/**
 * 按 id 在平表中查找节点。
 * @returns 命中的节点；未找到返回 null
 */
export function findNode(nodes: NodeItem[], id: string): NodeItem | null {
  return nodes.find((node) => node.id === id) ?? null;
}

/**
 * 获取某节点的全部后代 id（不含自身）。
 * @param nodes 平表
 * @param id 祖先节点 id
 * @returns 后代 id 集合
 */
export function getDescendantIds(nodes: NodeItem[], id: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parentId, siblings);
  }
  const result = new Set<string>();
  const stack = [...(childrenByParent.get(id) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    stack.push(...(childrenByParent.get(current) ?? []));
  }
  return result;
}

/**
 * 取某父级下的同级节点（可排除被拖动节点），按展示顺序返回。
 * @param nodes 平表
 * @param parentId 父级；根级为 null
 * @param excludeId 需要排除的节点（通常是正在拖动的节点）
 */
export function getSiblingNodes(nodes: NodeItem[], parentId: string | null, excludeId?: string): NodeItem[] {
  return nodes
    .filter((node) => node.parentId === parentId && node.id !== excludeId)
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    );
}

/**
 * 判断目标父级是否可接收被拖动节点（文件夹、非自身、非后代）。
 * @returns 可放置返回 true
 */
export function canMoveNode(nodes: NodeItem[], draggedId: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (parentId === draggedId) return false;
  const parent = findNode(nodes, parentId);
  if (parent?.kind !== "folder") return false;
  return !getDescendantIds(nodes, draggedId).has(parentId);
}

/**
 * 计算“拖到节点前/后”或“拖入文件夹”的落点。
 * @param nodes 平表
 * @param draggedId 正在拖动的节点 id
 * @param targetId 落点节点 id
 * @param position before/after/inside
 * @returns 目标父级与插入索引；非法落点返回 null
 * @example resolveDropTarget(nodes, dragged.id, target.id, "inside")
 */
export function resolveDropTarget(
  nodes: NodeItem[],
  draggedId: string,
  targetId: string,
  position: "before" | "after" | "inside",
): TreeDropTarget | null {
  if (draggedId === targetId) return null;
  const target = findNode(nodes, targetId);
  if (!target) return null;

  if (position === "inside") {
    if (!canMoveNode(nodes, draggedId, target.id)) return null;
    const children = getSiblingNodes(nodes, target.id, draggedId);
    return { parentId: target.id, index: children.length };
  }

  if (!canMoveNode(nodes, draggedId, target.parentId)) return null;
  const siblings = getSiblingNodes(nodes, target.parentId, draggedId);
  const targetIndex = siblings.findIndex((node) => node.id === target.id);
  if (targetIndex < 0) return null;
  return {
    parentId: target.parentId,
    index: position === "before" ? targetIndex : targetIndex + 1,
  };
}

/**
 * 拖到树空白处：放到根级末尾。
 * @returns 根级插入位置
 */
export function resolveRootDrop(nodes: NodeItem[], draggedId: string): TreeDropTarget {
  return { parentId: null, index: getSiblingNodes(nodes, null, draggedId).length };
}

/** 将毫秒时间格式化为「yyyy-MM-dd HH:mm」，用于信息面板/分享弹窗。 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
