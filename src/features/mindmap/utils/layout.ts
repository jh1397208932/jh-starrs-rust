/**
 * 思维导图自动布局。
 *
 * 只根据树结构和测量结果计算坐标，不持久化坐标；折叠节点不进入布局，但保留隐藏计数。
 * v2 支持 8 种结构，并输出关系线、外框与概要的几何附件。
 */

import type {
  LayoutBoundary,
  LayoutRelationship,
  LayoutSide,
  MindmapContent,
  MindmapLayout,
  MindmapStructure,
  MindmapTopic,
} from "@/types/mindmap";
import { measureTopic } from "./measure";

const H_GAP = 56;
const V_GAP = 18;
const ORG_H_GAP = 24;
const ORG_V_GAP = 48;
const TIMELINE_H_GAP = 96;
const TIMELINE_V_GAP = 12;
const FISHBONE_H_GAP = 88;
const FISHBONE_SPINE_LEN = 96;
const GROUP_PADDING = 10;
const GROUP_STACK = 8;
const SUMMARY_BRACKET = 14;
const SUMMARY_GAP = 10;

/** 手动坐标优先，否则使用自动布局坐标。 */
function placeWith(topic: MindmapTopic, autoX: number, autoY: number): { x: number; y: number } {
  return topic.pos ? { x: topic.pos.x, y: topic.pos.y } : { x: autoX, y: autoY };
}

interface SizedTopic {
  topic: MindmapTopic;
  width: number;
  height: number;
  subtreeHeight: number;
  subtreeWidth: number;
  children: SizedTopic[];
  hiddenCount: number;
}

/** 计算当前画布的可见节点、连线与几何附件。 */
export function layoutMindmap(content: MindmapContent): MindmapLayout {
  const sized = sizeTopic(content.sheet.root, true);
  const structure = content.sheet.structure;
  const nodes: MindmapLayout["nodes"] = [];
  const edges: MindmapLayout["edges"] = [];

  if (structure === "org-down" || structure === "org-up") {
    layoutOrg(sized, 0, 0, 0, structure === "org-up", nodes, edges);
  } else if (structure === "timeline") {
    layoutTimeline(sized, nodes, edges);
  } else if (structure === "fishbone") {
    layoutFishbone(sized, nodes, edges);
  } else {
    // balanced / logic-right / logic-left / tree 共用水平布局
    const sides = splitSides(sized.children, structure);
    const rightHeight = sides.right.reduce((total, child) => total + child.subtreeHeight + V_GAP, -V_GAP);
    const leftHeight = sides.left.reduce((total, child) => total + child.subtreeHeight + V_GAP, -V_GAP);
    const rootY = Math.max(0, Math.max(rightHeight, leftHeight) / 2 - sized.height / 2);
    const rootAt = placeWith(sized.topic, 0, rootY);
    nodes.push(node(sized, rootAt.x, rootAt.y, 0, "root", 0));
    if (structure === "logic-left") {
      layoutHorizontal(sized, rootAt.x, rootAt.y, "left", sized.children, 1, nodes, edges);
    } else {
      layoutHorizontal(sized, rootAt.x, rootAt.y, "right", sides.right, 1, nodes, edges);
      layoutHorizontal(sized, rootAt.x, rootAt.y, "left", sides.left, 1, nodes, edges);
    }
  }

  const result: MindmapLayout = {
    nodes,
    edges,
    relationships: [],
    boundaries: [],
    summaries: [],
    width: 0,
    height: 0,
  };
  attachFreeTopics(content, result);
  attachSummaries(content, structure, result);
  attachRelationships(content, result);
  attachBoundaries(content, structure, result);
  if (content.sheet.showNumbers) attachNumbers(content, result);

  const bounds = result.nodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.x),
      minY: Math.min(acc.minY, node.y),
      maxX: Math.max(acc.maxX, node.x + node.width),
      maxY: Math.max(acc.maxY, node.y + node.height),
    }),
    { minX: 0, minY: 0, maxX: sized.width, maxY: sized.height },
  );
  result.width = bounds.maxX - bounds.minX;
  result.height = bounds.maxY - bounds.minY;
  return result;
}

function sizeTopic(topic: MindmapTopic, isRoot: boolean): SizedTopic {
  const { width, height } = measureTopic(topic, isRoot);
  const expanded = !topic.collapsed;
  const children = expanded ? (topic.children ?? []).map((child) => sizeTopic(child, false)) : [];
  const hiddenCount = expanded
    ? 0
    : (topic.children ?? []).reduce((total, child) => total + countSubtree(child), 0);
  const childrenHeight = children.reduce((total, child) => total + child.subtreeHeight + V_GAP, -V_GAP);
  const childrenWidth = children.reduce((total, child) => total + child.subtreeWidth + ORG_H_GAP, -ORG_H_GAP);
  return {
    topic,
    width,
    height,
    subtreeHeight: Math.max(height, childrenHeight),
    subtreeWidth: Math.max(width, childrenWidth),
    children,
    hiddenCount,
  };
}

function countSubtree(topic: MindmapTopic): number {
  return 1 + (topic.children ?? []).reduce((total, child) => total + countSubtree(child), 0);
}

function node(
  sized: SizedTopic,
  x: number,
  y: number,
  depth: number,
  side: LayoutSide,
  branchIndex: number,
): MindmapLayout["nodes"][number] {
  return {
    id: sized.topic.id,
    x,
    y,
    width: sized.width,
    height: sized.height,
    depth,
    side,
    branchIndex,
    hiddenCount: sized.hiddenCount,
    topic: sized.topic,
  };
}

function splitSides(children: SizedTopic[], structure: MindmapStructure) {
  if (structure === "logic-right" || structure === "tree") {
    return { right: children, left: [] as SizedTopic[] };
  }
  if (structure === "logic-left") return { right: [] as SizedTopic[], left: children };
  const right: SizedTopic[] = [];
  const left: SizedTopic[] = [];
  children.forEach((child, index) => {
    (index % 2 === 0 ? right : left).push(child);
  });
  return { right, left };
}

function layoutHorizontal(
  parent: SizedTopic,
  parentX: number,
  parentY: number,
  side: "left" | "right",
  children: SizedTopic[],
  depth: number,
  nodes: MindmapLayout["nodes"],
  edges: MindmapLayout["edges"],
): void {
  const totalHeight = children.reduce((total, child) => total + child.subtreeHeight + V_GAP, -V_GAP);
  let cursorY = parentY + parent.height / 2 - totalHeight / 2;
  children.forEach((child, index) => {
    const autoX = side === "right" ? parentX + parent.width + H_GAP : parentX - H_GAP - child.width;
    const { x, y } = placeWith(child.topic, autoX, cursorY);
    nodes.push(node(child, x, y, depth, side, index));
    edges.push(
      edge(
        parent,
        child,
        side === "right" ? "right" : "left",
        side === "right" ? "left" : "right",
        index,
        depth,
      ),
    );
    cursorY += child.subtreeHeight + V_GAP;
    layoutChildren(child, x, y, side, depth + 1, nodes, edges);
  });
}

function layoutChildren(
  parent: SizedTopic,
  parentX: number,
  parentY: number,
  side: "left" | "right",
  depth: number,
  nodes: MindmapLayout["nodes"],
  edges: MindmapLayout["edges"],
): void {
  layoutHorizontal(parent, parentX, parentY, side, parent.children, depth, nodes, edges);
}

function edge(
  parent: SizedTopic,
  child: SizedTopic,
  sourceHandle: string,
  targetHandle: string,
  branchIndex: number,
  depth: number,
): MindmapLayout["edges"][number] {
  return {
    id: `${parent.topic.id}->${child.topic.id}`,
    source: parent.topic.id,
    target: child.topic.id,
    sourceHandle,
    targetHandle,
    branchIndex,
    depth,
  };
}

function layoutOrg(
  node_: SizedTopic,
  x: number,
  y: number,
  depth: number,
  upward: boolean,
  nodes: MindmapLayout["nodes"],
  edges: MindmapLayout["edges"],
): void {
  const placed = placeWith(node_.topic, x, y);
  nodes.push(node(node_, placed.x, placed.y, depth, depth === 0 ? "root" : "down", 0));
  const totalWidth = node_.children.reduce((total, child) => total + child.width + ORG_H_GAP, -ORG_H_GAP);
  let cursorX = placed.x + node_.width / 2 - totalWidth / 2;
  node_.children.forEach((child) => {
    const childY = upward ? placed.y - ORG_V_GAP - child.height : placed.y + node_.height + ORG_V_GAP;
    edges.push(edge(node_, child, upward ? "up" : "down", upward ? "down" : "up", 0, depth + 1));
    layoutOrg(child, cursorX, childY, depth + 1, upward, nodes, edges);
    cursorX += child.width + ORG_H_GAP;
  });
}

/** 时间轴：根主题在最左，子主题是横向排布的里程碑，孙级在里程碑下纵向堆叠。 */
function layoutTimeline(
  root: SizedTopic,
  nodes: MindmapLayout["nodes"],
  edges: MindmapLayout["edges"],
): void {
  const axisY = 0;
  const rootAt = placeWith(root.topic, 0, axisY - root.height / 2);
  nodes.push(node(root, rootAt.x, rootAt.y, 0, "root", 0));
  let cursorX = rootAt.x + root.width + TIMELINE_H_GAP;
  root.children.forEach((milestone, index) => {
    const columnAt = placeWith(milestone.topic, cursorX, axisY - milestone.height / 2);
    nodes.push(node(milestone, columnAt.x, columnAt.y, 1, "right", index));
    edges.push(edge(root, milestone, "right", "left", index, 1));
    let eventY = columnAt.y + milestone.height + TIMELINE_V_GAP;
    milestone.children.forEach((event, eventIndex) => {
      const eventAt = placeWith(event.topic, columnAt.x + 24, eventY);
      nodes.push(node(event, eventAt.x, eventAt.y, 2, "down", eventIndex));
      edges.push(edge(milestone, event, "down", "up", eventIndex, 2));
      let subY = eventAt.y + event.height + TIMELINE_V_GAP;
      event.children.forEach((sub, subIndex) => {
        const subAt = placeWith(sub.topic, columnAt.x + 48, subY);
        nodes.push(node(sub, subAt.x, subAt.y, 3, "down", subIndex));
        edges.push(edge(event, sub, "down", "up", subIndex, 3));
        subY += sub.height + TIMELINE_V_GAP;
      });
      eventY = subY;
    });
    cursorX += milestone.subtreeWidth + TIMELINE_H_GAP;
  });
}

/** 鱼骨图：根主题在脊骨左端，子主题交替上下呈骨刺，孙级沿骨刺向外排布。 */
function layoutFishbone(
  root: SizedTopic,
  nodes: MindmapLayout["nodes"],
  edges: MindmapLayout["edges"],
): void {
  const rootAt = placeWith(root.topic, 0, -root.height / 2);
  const spineY = rootAt.y + root.height / 2;
  nodes.push(node(root, rootAt.x, rootAt.y, 0, "root", 0));
  let cursorX = rootAt.x + root.width + FISHBONE_H_GAP;
  root.children.forEach((bone, index) => {
    const up = index % 2 === 0;
    const boneLen = FISHBONE_SPINE_LEN + bone.subtreeHeight / 2;
    const boneY = up ? spineY - boneLen - bone.height / 2 : spineY + boneLen - bone.height / 2;
    const boneAt = placeWith(bone.topic, cursorX, boneY);
    nodes.push(node(bone, boneAt.x, boneAt.y, 1, up ? "left" : "down", index));
    edges.push(edge(root, bone, "right", up ? "right" : "left", index, 1));
    let subY = up
      ? boneAt.y - (bone.height / 2 + TIMELINE_V_GAP + 0)
      : boneAt.y + bone.height + TIMELINE_V_GAP;
    bone.children.forEach((sub, subIndex) => {
      const subX = up ? boneAt.x : boneAt.x + 24;
      const y = up ? subY - sub.height : subY;
      const subAt = placeWith(sub.topic, subX, y);
      nodes.push(node(sub, subAt.x, subAt.y, 2, up ? "left" : "down", subIndex));
      edges.push(edge(bone, sub, up ? "left" : "down", up ? "down" : "up", subIndex, 2));
      subY = up ? subAt.y - TIMELINE_V_GAP : subAt.y + sub.height + TIMELINE_V_GAP;
    });
    cursorX += Math.max(bone.width, bone.subtreeWidth) + FISHBONE_H_GAP;
  });
}

/** 概要：括号线 + 悬空概要主题节点（同时参与关系线与外框几何）。 */
function attachSummaries(content: MindmapContent, structure: MindmapStructure, result: MindmapLayout): void {
  let stack = 0;
  for (const summary of content.summaries ?? []) {
    const members = result.nodes.filter(
      (candidate) => summary.childIds.includes(candidate.id) && candidate.depth > 0,
    );
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((member) => member.x));
    const maxX = Math.max(...members.map((member) => member.x + member.width));
    const minY = Math.min(...members.map((member) => member.y));
    const maxY = Math.max(...members.map((member) => member.y + member.height));
    const vertical = structure === "org-down" || structure === "org-up";
    const offset = stack * GROUP_STACK;
    stack += 1;
    const measured = measureTopic(summary.topic, false);
    if (vertical) {
      const bracketY = maxY + SUMMARY_GAP + offset;
      result.summaries.push({
        id: summary.id,
        x: minX,
        y: bracketY,
        width: maxX - minX,
        height: SUMMARY_BRACKET,
        direction: "down",
      });
      const topicAt = placeWith(summary.topic, minX, bracketY + SUMMARY_BRACKET + SUMMARY_GAP);
      result.nodes.push({
        id: summary.topic.id,
        x: topicAt.x,
        y: topicAt.y,
        width: measured.width,
        height: measured.height,
        depth: 1,
        side: "down",
        branchIndex: 0,
        hiddenCount: 0,
        topic: summary.topic,
      });
    } else {
      const bracketX = maxX + SUMMARY_GAP + offset;
      result.summaries.push({
        id: summary.id,
        x: bracketX,
        y: minY,
        width: SUMMARY_BRACKET,
        height: maxY - minY,
        direction: "right",
      });
      const topicAt = placeWith(
        summary.topic,
        bracketX + SUMMARY_BRACKET + SUMMARY_GAP,
        minY + (maxY - minY) / 2 - measured.height / 2,
      );
      result.nodes.push({
        id: summary.topic.id,
        x: topicAt.x,
        y: topicAt.y,
        width: measured.width,
        height: measured.height,
        depth: 1,
        side: "right",
        branchIndex: 0,
        hiddenCount: 0,
        topic: summary.topic,
      });
    }
  }
}

/** 关系线：端点缺失（折叠/不存在）时跳过；与无关节点相交时绕行。 */
function attachRelationships(content: MindmapContent, result: MindmapLayout): void {
  for (const relationship of content.relationships ?? []) {
    const fromNode = result.nodes.find((node) => node.id === relationship.from);
    const toNode = result.nodes.find((node) => node.id === relationship.to);
    if (!fromNode || !toNode) continue;
    const from = { x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 };
    const to = { x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 };
    const blockers = result.nodes.filter((node) => {
      if (node.id === fromNode.id || node.id === toNode.id) return false;
      return segmentHitsRect(from, to, node);
    });
    let path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    if (blockers.length > 0) {
      const minY = Math.min(...blockers.map((node) => node.y));
      const maxY = Math.max(...blockers.map((node) => node.y + node.height));
      const midX = (from.x + to.x) / 2;
      const above = Math.abs(minY - Math.min(from.y, to.y)) < Math.abs(maxY - Math.max(from.y, to.y));
      const controlY = above ? minY - 48 : maxY + 48;
      path = `M ${from.x} ${from.y} Q ${midX} ${controlY} ${to.x} ${to.y}`;
    }
    const geometry: LayoutRelationship = {
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      label: relationship.label,
      color: relationship.color,
      path,
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
    };
    result.relationships.push(geometry);
  }
}

/** 线段是否穿过节点的包围盒（含 6px 余量）。 */
function segmentHitsRect(
  from: { x: number; y: number },
  to: { x: number; y: number },
  node: { x: number; y: number; width: number; height: number },
): boolean {
  const padding = 6;
  const left = node.x - padding;
  const right = node.x + node.width + padding;
  const top = node.y - padding;
  const bottom = node.y + node.height + padding;
  for (let step = 1; step < 24; step += 1) {
    const ratio = step / 24;
    const x = from.x + (to.x - from.x) * ratio;
    const y = from.y + (to.y - from.y) * ratio;
    if (x >= left && x <= right && y >= top && y <= bottom) return true;
  }
  return false;
}

/** 自由主题：以 pos 为根坐标，子树向右排布。 */
function attachFreeTopics(content: MindmapContent, result: MindmapLayout): void {
  for (const free of content.freeTopics ?? []) {
    const sized = sizeTopic(free, false);
    const x = free.pos?.x ?? 0;
    const y = free.pos?.y ?? 0;
    const placed = { ...node(sized, x, y, 0, "right", 0), free: true };
    result.nodes.push(placed);
    layoutHorizontal(sized, x, y, "right", sized.children, 1, result.nodes, result.edges);
  }
}

/** 自动编号：一级 1、2、3…，后续 1.1、1.2…。 */
function attachNumbers(content: MindmapContent, result: MindmapLayout): void {
  const numbers = new Map<string, string>();
  const walk = (topic: MindmapTopic, prefix: string) => {
    (topic.children ?? []).forEach((child, index) => {
      const value = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      numbers.set(child.id, value);
      walk(child, value);
    });
  };
  walk(content.sheet.root, "");
  for (const node of result.nodes) {
    const value = numbers.get(node.id);
    if (value) node.number = value;
  }
}

/** 外框：成员节点的包围盒 + 内边距；同父多框错位堆叠。 */
function attachBoundaries(
  content: MindmapContent,
  _structure: MindmapStructure,
  result: MindmapLayout,
): void {
  const byParent = new Map<string, number>();
  for (const boundary of content.boundaries ?? []) {
    const members = result.nodes.filter((candidate) => boundary.childIds.includes(candidate.id));
    if (members.length === 0) continue;
    const minX = Math.min(...members.map((member) => member.x));
    const maxX = Math.max(...members.map((member) => member.x + member.width));
    const minY = Math.min(...members.map((member) => member.y));
    const maxY = Math.max(...members.map((member) => member.y + member.height));
    const offset = (byParent.get(boundary.parent) ?? 0) * GROUP_STACK;
    byParent.set(boundary.parent, (byParent.get(boundary.parent) ?? 0) + 1);
    const geometry: LayoutBoundary = {
      id: boundary.id,
      label: boundary.label,
      color: boundary.color,
      x: minX - GROUP_PADDING - offset,
      y: minY - GROUP_PADDING - offset,
      width: maxX - minX + GROUP_PADDING * 2,
      height: maxY - minY + GROUP_PADDING * 2,
      memberIds: members.map((member) => member.id),
    };
    result.boundaries.push(geometry);
  }
}
