/**
 * 思维导图树操作。
 *
 * 所有命令都返回新对象，避免 React 状态被就地修改；路径使用从根开始的子节点下标。
 */

import type { MindmapContent, MindmapTopic } from "@/types/mindmap";

/** 在树中查找主题。 */
export function findTopic(root: MindmapTopic, id: string): MindmapTopic | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findTopic(child, id);
    if (found) return found;
  }
  return null;
}

/** 查找某主题的父主题 id；根主题或未找到返回 null。 */
export function parentIdOf(content: MindmapContent, childId: string): string | null {
  const walk = (topic: MindmapTopic): string | null => {
    for (const child of topic.children ?? []) {
      if (child.id === childId) return topic.id;
      const nested = walk(child);
      if (nested) return nested;
    }
    return null;
  };
  return walk(content.sheet.root);
}

/** 在整份场景中查找主题，包括概要结论主题与自由主题子树。 */
export function findTopicInContent(content: MindmapContent, id: string): MindmapTopic | null {
  return (
    findTopic(content.sheet.root, id) ??
    (content.summaries ?? []).find((summary) => summary.topic.id === id)?.topic ??
    (content.freeTopics ?? []).map((topic) => findTopic(topic, id)).find(Boolean) ??
    null
  );
}

/** 返回从根到目标的下标路径；根路径为空数组。 */
export function topicPath(root: MindmapTopic, id: string): number[] | null {
  if (root.id === id) return [];
  for (const [index, child] of (root.children ?? []).entries()) {
    const nested = topicPath(child, id);
    if (nested) return [index, ...nested];
  }
  return null;
}

/** 按下标路径读取主题。 */
export function topicAtPath(root: MindmapTopic, path: number[]): MindmapTopic | null {
  let current = root;
  for (const index of path) {
    const child = current.children?.[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

/** 不可变替换路径上的主题。 */
export function replaceAtPath(root: MindmapTopic, path: number[], replacement: MindmapTopic): MindmapTopic {
  if (path.length === 0) return replacement;
  const [index, ...rest] = path;
  const children = [...(root.children ?? [])];
  if (index >= children.length) return root;
  children[index] = replaceAtPath(children[index], rest, replacement);
  return { ...root, children };
}

/** 添加子主题。 */
export function addChild(
  content: MindmapContent,
  parentId: string,
  topic: MindmapTopic,
): MindmapContent | null {
  return updateTopic(content, parentId, (parent) => ({
    ...parent,
    collapsed: false,
    children: [...(parent.children ?? []), topic],
  }));
}

/** 添加同级主题。 */
export function addSibling(
  content: MindmapContent,
  siblingId: string,
  topic: MindmapTopic,
): MindmapContent | null {
  const path = topicPath(content.sheet.root, siblingId);
  if (!path || path.length === 0) return addChild(content, siblingId, topic);
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = topicAtPath(content.sheet.root, parentPath);
  if (!parent) return null;
  const children = [...(parent.children ?? [])];
  children.splice(index + 1, 0, topic);
  return {
    ...content,
    sheet: {
      ...content.sheet,
      root: replaceAtPath(content.sheet.root, parentPath, { ...parent, children }),
    },
  };
}

/** 删除主题及其子树；引用它的关系线/外框/概要同步清理。 */
export function removeTopic(content: MindmapContent, id: string): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = topicAtPath(content.sheet.root, parentPath);
  if (!parent) return null;
  const removed = topicAtPath(content.sheet.root, path);
  const removedIds = removed ? collectIds(removed) : new Set([id]);
  const children = [...(parent.children ?? [])];
  children.splice(index, 1);
  return pruneGroups(
    {
      ...content,
      sheet: {
        ...content.sheet,
        root: replaceAtPath(content.sheet.root, parentPath, { ...parent, children }),
      },
    },
    removedIds,
  );
}

/** 把 sourceId 移动为 targetId 的最后一个子主题。 */
export function moveUnder(
  content: MindmapContent,
  sourceId: string,
  targetId: string,
): MindmapContent | null {
  if (sourceId === targetId) return content;
  const source = findTopic(content.sheet.root, sourceId);
  const target = findTopic(content.sheet.root, targetId);
  if (!source || !target) return null;
  const targetPath = topicPath(content.sheet.root, targetId);
  const sourcePath = topicPath(content.sheet.root, sourceId);
  if (!targetPath || !sourcePath) return null;
  if (isDescendantPath(sourcePath, targetPath)) return null;
  // 摘挂而不是“先删后加”：删除路径会顺手清掉子树引用的关系线/外框/概要。
  const detached = detachTopic(content, sourceId);
  if (!detached) return null;
  // 拖拽换父后重新参与自动布局，旧的手动坐标会把它钉在无关位置。
  return addChild(detached, targetId, { ...source, pos: null });
}

/** 从树上摘下主题（不下钻清理关系线/外框/概要引用）；根主题返回 null。 */
export function detachTopic(content: MindmapContent, id: string): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = topicAtPath(content.sheet.root, parentPath);
  if (!parent) return null;
  const children = [...(parent.children ?? [])];
  children.splice(index, 1);
  return {
    ...content,
    sheet: {
      ...content.sheet,
      root: replaceAtPath(content.sheet.root, parentPath, { ...parent, children }),
    },
  };
}

/** 在同一父级下移动主题。 */
export function moveSibling(content: MindmapContent, id: string, direction: -1 | 1): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path || path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = topicAtPath(content.sheet.root, parentPath);
  const children = [...(parent?.children ?? [])];
  const target = index + direction;
  if (!parent || target < 0 || target >= children.length) return null;
  const [moved] = children.splice(index, 1);
  children.splice(target, 0, moved);
  return {
    ...content,
    sheet: { ...content.sheet, root: replaceAtPath(content.sheet.root, parentPath, { ...parent, children }) },
  };
}

/** 升级主题：移动到父级的父级下。 */
export function promoteTopic(content: MindmapContent, id: string): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path || path.length < 2) return null;
  const parentPath = path.slice(0, -1);
  const grandparentPath = parentPath.slice(0, -1);
  const source = topicAtPath(content.sheet.root, path);
  const parent = topicAtPath(content.sheet.root, parentPath);
  const grandparent = topicAtPath(content.sheet.root, grandparentPath);
  if (!source || !parent || !grandparent) return null;
  const parentIndex = parentPath[parentPath.length - 1];
  // 摘挂而不是先删后加：删除路径会顺手清掉源子树引用的关系线/外框/概要。
  const withoutSource = detachTopic(content, id);
  if (!withoutSource) return null;
  const updatedGrandparent = topicAtPath(withoutSource.sheet.root, grandparentPath);
  if (!updatedGrandparent) return null;
  const children = [...(updatedGrandparent.children ?? [])];
  children.splice(parentIndex + 1, 0, source);
  return {
    ...withoutSource,
    sheet: {
      ...withoutSource.sheet,
      root: replaceAtPath(withoutSource.sheet.root, grandparentPath, {
        ...updatedGrandparent,
        children,
      }),
    },
  };
}

/** 降级主题：移动到前一个同级主题的最后一个子主题。 */
export function demoteTopic(content: MindmapContent, id: string): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path || path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  if (index === 0) return null;
  const siblings = topicAtPath(content.sheet.root, parentPath)?.children ?? [];
  return moveUnder(content, id, siblings[index - 1].id);
}

/** 切换折叠。 */
export function toggleCollapsed(content: MindmapContent, id: string): MindmapContent | null {
  return updateTopic(content, id, (topic) => ({ ...topic, collapsed: !topic.collapsed }));
}

/** 统计主题数。 */
export function countTopics(topic: MindmapTopic): number {
  return 1 + (topic.children ?? []).reduce((total, child) => total + countTopics(child), 0);
}

/** 展开目标所需的全部祖先。 */
export function expandAncestors(content: MindmapContent, id: string): MindmapContent | null {
  const path = topicPath(content.sheet.root, id);
  if (!path) return null;
  let current = content;
  for (let depth = 0; depth < path.length; depth += 1) {
    const ancestorPath = path.slice(0, depth);
    const ancestor = topicAtPath(current.sheet.root, ancestorPath);
    if (!ancestor?.collapsed) continue;
    const updated = replaceAtPath(current.sheet.root, ancestorPath, { ...ancestor, collapsed: false });
    if (!updated) return null;
    current = { ...current, sheet: { ...current.sheet, root: updated } };
  }
  return current;
}

/** 更新主题字段；概要主题不在树中，这里一并支持。 */
export function updateTopic(
  content: MindmapContent,
  id: string,
  update: (topic: MindmapTopic) => MindmapTopic,
): MindmapContent | null {
  const path = topicPath(content.sheet.root, id);
  if (path) {
    const current = topicAtPath(content.sheet.root, path);
    if (!current) return null;
    return {
      ...content,
      sheet: {
        ...content.sheet,
        root: replaceAtPath(content.sheet.root, path, update(current)),
      },
    };
  }
  const summaryIndex = (content.summaries ?? []).findIndex((summary) => summary.topic.id === id);
  if (summaryIndex >= 0) {
    const summaries = [...(content.summaries ?? [])];
    summaries[summaryIndex] = { ...summaries[summaryIndex], topic: update(summaries[summaryIndex].topic) };
    return { ...content, summaries };
  }
  const freeIndex = (content.freeTopics ?? []).findIndex((topic) => findTopic(topic, id) !== null);
  if (freeIndex < 0) return null;
  const freeTopics = [...(content.freeTopics ?? [])];
  freeTopics[freeIndex] = updateFree(freeTopics[freeIndex], id, update);
  return { ...content, freeTopics };
}

/** 在自由主题子树内按 id 替换。 */
function updateFree(
  topic: MindmapTopic,
  id: string,
  update: (topic: MindmapTopic) => MindmapTopic,
): MindmapTopic {
  if (topic.id === id) return update(topic);
  const children = (topic.children ?? []).map((child) => updateFree(child, id, update));
  return { ...topic, children };
}

/** 深度优先收集一棵子树内的全部主题 id。 */
function collectIds(topic: MindmapTopic, into: Set<string> = new Set()): Set<string> {
  into.add(topic.id);
  for (const child of topic.children ?? []) collectIds(child, into);
  return into;
}

/** 删除一组主题后，同步清理引用它们的关系线、外框与概要。 */
export function pruneGroups(content: MindmapContent, removedIds: Set<string>): MindmapContent {
  const relationships = (content.relationships ?? []).filter(
    (relationship) => !removedIds.has(relationship.from) && !removedIds.has(relationship.to),
  );
  const boundaries = (content.boundaries ?? [])
    .map((boundary) => ({
      ...boundary,
      childIds: boundary.childIds.filter((childId) => !removedIds.has(childId)),
    }))
    .filter((boundary) => boundary.childIds.length > 0 && !removedIds.has(boundary.parent));
  const summaries = (content.summaries ?? [])
    .map((summary) => ({
      ...summary,
      childIds: summary.childIds.filter((childId) => !removedIds.has(childId)),
    }))
    .filter((summary) => summary.childIds.length > 0 && !removedIds.has(summary.parent));
  return { ...content, relationships, boundaries, summaries };
}

/** 新建自由主题（带初始坐标）。 */
export function addFreeTopic(
  content: MindmapContent,
  topic: MindmapTopic,
  pos: { x: number; y: number },
): MindmapContent {
  return {
    ...content,
    freeTopics: [...(content.freeTopics ?? []), { ...topic, pos }],
  };
}

/** 删除自由主题（含子树内的任意节点），并清理引用它们的编组。 */
export function removeFreeTopic(content: MindmapContent, id: string): MindmapContent | null {
  const roots = content.freeTopics ?? [];
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    if (root.id === id) {
      const removedIds = collectIds(root);
      const freeTopics = [...roots];
      freeTopics.splice(index, 1);
      return pruneGroups({ ...content, freeTopics }, removedIds);
    }
    const target = findTopic(root, id);
    if (!target) continue;
    const removedIds = collectIds(target);
    const updated = detachFreeChild(root, id);
    if (!updated) continue;
    const freeTopics = [...roots];
    freeTopics[index] = updated;
    return pruneGroups({ ...content, freeTopics }, removedIds);
  }
  return null;
}

/** 在自由主题子树内摘下一个节点（不清理引用）。 */
function detachFreeChild(topic: MindmapTopic, id: string): MindmapTopic | null {
  for (const [index, child] of (topic.children ?? []).entries()) {
    if (child.id === id) {
      const children = [...(topic.children ?? [])];
      children.splice(index, 1);
      return { ...topic, children };
    }
    const nested = detachFreeChild(child, id);
    if (nested) {
      const children = [...(topic.children ?? [])];
      children[index] = nested;
      return { ...topic, children };
    }
  }
  return null;
}

/** 记录/清除主题的手动坐标（null 表示回到自动布局）。 */
export function setTopicPos(
  content: MindmapContent,
  id: string,
  pos: { x: number; y: number } | null,
): MindmapContent | null {
  return updateTopic(content, id, (topic) => ({ ...topic, pos }));
}

/** 清除手动坐标：树、概要与自由主题子树回到自动布局；自由主题自身位置保留。 */
export function clearTopicPositions(content: MindmapContent): MindmapContent {
  const reset = (topic: MindmapTopic, keepSelf: boolean): MindmapTopic => ({
    ...topic,
    pos: keepSelf ? (topic.pos ?? null) : null,
    children: (topic.children ?? []).map((child) => reset(child, false)),
  });
  return {
    ...content,
    sheet: { ...content.sheet, root: reset(content.sheet.root, false) },
    summaries: (content.summaries ?? []).map((summary) => ({
      ...summary,
      topic: reset(summary.topic, false),
    })),
    freeTopics: (content.freeTopics ?? []).map((topic) => reset(topic, true)),
  };
}

/** 把同父的 id 移动到 targetIndex 位置。 */
export function reorderSibling(
  content: MindmapContent,
  id: string,
  targetIndex: number,
): MindmapContent | null {
  if (content.sheet.root.id === id) return null;
  const path = topicPath(content.sheet.root, id);
  if (!path || path.length === 0) return null;
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = topicAtPath(content.sheet.root, parentPath);
  if (!parent) return null;
  const children = [...(parent.children ?? [])];
  const [moved] = children.splice(index, 1);
  const clamped = Math.max(0, Math.min(targetIndex, children.length));
  children.splice(clamped, 0, { ...moved, pos: null });
  return {
    ...content,
    sheet: { ...content.sheet, root: replaceAtPath(content.sheet.root, parentPath, { ...parent, children }) },
  };
}

/** 把自由主题挂到树主题下（拖拽吸附）。 */
export function attachFreeTopic(
  content: MindmapContent,
  freeId: string,
  targetId: string,
): MindmapContent | null {
  const freeTopic = (content.freeTopics ?? []).find((topic) => topic.id === freeId);
  if (!freeTopic) return null;
  // 摘下时不清理引用：它只是换了位置，关系线/外框/概要仍然指向同一批 id。
  const freeTopics = (content.freeTopics ?? []).filter((topic) => topic.id !== freeId);
  return addChild({ ...content, freeTopics }, targetId, { ...freeTopic, pos: null });
}

/** 删除概要结论主题时移除整条概要。 */
export function removeSummaryOfTopic(content: MindmapContent, topicId: string): MindmapContent | null {
  const summary = (content.summaries ?? []).find((item) => item.topic.id === topicId);
  if (!summary) return null;
  return removeSummary(content, summary.id);
}

/** 全部展开/折叠。 */
export function setAllCollapsed(content: MindmapContent, collapsed: boolean): MindmapContent {
  const walk = (topic: MindmapTopic): MindmapTopic => ({
    ...topic,
    collapsed: collapsed && (topic.children?.length ?? 0) > 0,
    children: (topic.children ?? []).map(walk),
  });
  return { ...content, sheet: { ...content.sheet, root: walk(content.sheet.root) } };
}

/** 新建关系线。 */
export function addRelationship(content: MindmapContent, from: string, to: string): MindmapContent {
  const relationship = {
    id: `rel-${crypto.randomUUID()}`,
    from,
    to,
    label: "",
    color: "auto",
  };
  return { ...content, relationships: [...(content.relationships ?? []), relationship] };
}

/** 更新关系线；返回 null 表示找不到。 */
export function updateRelationship(
  content: MindmapContent,
  id: string,
  patch: Partial<{ label: string; color: string }>,
): MindmapContent | null {
  const index = (content.relationships ?? []).findIndex((item) => item.id === id);
  if (index < 0) return null;
  const relationships = [...(content.relationships ?? [])];
  relationships[index] = { ...relationships[index], ...patch };
  return { ...content, relationships };
}

/** 删除关系线。 */
export function removeRelationship(content: MindmapContent, id: string): MindmapContent {
  return { ...content, relationships: (content.relationships ?? []).filter((item) => item.id !== id) };
}

/** 新建外框：圈住同一父主题下的一组兄弟。 */
export function addBoundary(
  content: MindmapContent,
  parent: string,
  childIds: string[],
  label = "",
): MindmapContent {
  const boundary = { id: `bd-${crypto.randomUUID()}`, parent, childIds, label, color: "auto" };
  return { ...content, boundaries: [...(content.boundaries ?? []), boundary] };
}

/** 更新外框标签/颜色。 */
export function updateBoundary(
  content: MindmapContent,
  id: string,
  patch: Partial<{ label: string; color: string }>,
): MindmapContent | null {
  const index = (content.boundaries ?? []).findIndex((item) => item.id === id);
  if (index < 0) return null;
  const boundaries = [...(content.boundaries ?? [])];
  boundaries[index] = { ...boundaries[index], ...patch };
  return { ...content, boundaries };
}

/** 删除外框。 */
export function removeBoundary(content: MindmapContent, id: string): MindmapContent {
  return { ...content, boundaries: (content.boundaries ?? []).filter((item) => item.id !== id) };
}

/** 新建概要：括住一组兄弟并挂结论主题。 */
export function addSummary(
  content: MindmapContent,
  parent: string,
  childIds: string[],
  topic: MindmapTopic,
): MindmapContent {
  const summary = { id: `sum-${crypto.randomUUID()}`, parent, childIds, topic };
  return { ...content, summaries: [...(content.summaries ?? []), summary] };
}

/** 删除概要（连同其结论主题的引用清理由调用方按需处理）。 */
export function removeSummary(content: MindmapContent, id: string): MindmapContent {
  return { ...content, summaries: (content.summaries ?? []).filter((item) => item.id !== id) };
}

/** 创建新主题。 */
export function createTopic(text = ""): MindmapTopic {
  return {
    id: `topic-${crypto.randomUUID()}`,
    text,
    children: [],
  };
}

/** 深拷贝子树并换发全部 id，避免粘贴造成唯一约束冲突。 */
export function cloneTopic(topic: MindmapTopic): MindmapTopic {
  return {
    ...topic,
    id: `topic-${crypto.randomUUID()}`,
    children: (topic.children ?? []).map(cloneTopic),
  };
}

function isDescendantPath(ancestor: number[], descendant: number[]): boolean {
  if (descendant.length <= ancestor.length) return false;
  return ancestor.every((value, index) => descendant[index] === value);
}
