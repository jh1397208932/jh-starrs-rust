/**
 * 思维导图纯逻辑烟雾测试（Node 运行，无需窗口）。
 *
 * 覆盖拆分后的布局/树命令/拖拽落点判定，防止组件拆分时语义漂移。
 */

import { layoutMindmap } from "@/features/mindmap/utils/layout";
import { resolveDrop } from "@/features/mindmap/utils/dropTarget";
import { hitTestFrame } from "@/features/mindmap/utils/frameHit";
import { pickDirectionalNode } from "@/features/mindmap/utils/navigation";
import { renderMindmapSvg } from "@/features/mindmap/utils/exportGraphics";
import { safeExternalUrl } from "@/api/urlSafety";
import {
  addBoundary,
  addFreeTopic,
  addRelationship,
  addSummary,
  clearTopicPositions,
  createTopic,
  moveSibling,
  removeFreeTopic,
  reorderSibling,
  setTopicPos,
  updateTopic,
} from "@/features/mindmap/utils/tree";
import type { MindmapContent, MindmapLayout, MindmapTopic } from "@/types/mindmap";

function stubDom(): void {
  let lastText = "";
  const probe = {
    style: {} as Record<string, string>,
    set textContent(value: string) {
      lastText = value;
    },
    get offsetWidth() {
      return lastText.length * 9;
    },
  };
  globalThis.document = {
    createElement: () => probe,
    body: { appendChild: () => undefined },
  } as unknown as Document;
  globalThis.getComputedStyle = (() => ({ fontFamily: "stub-font" })) as unknown as typeof getComputedStyle;
}

const topic = (id: string, text: string, children: MindmapTopic[] = []): MindmapTopic => ({
  id,
  text,
  children,
});

function baseContent(): MindmapContent {
  return {
    schemaVersion: 2,
    sheet: {
      id: "sheet-smoke01",
      structure: "balanced",
      theme: "auto",
      root: topic("topic-root0001", "根", [
        topic("topic-child001", "甲"),
        topic("topic-child002", "乙"),
        topic("topic-child003", "丙"),
      ]),
    },
    relationships: [],
    boundaries: [],
    summaries: [],
    freeTopics: [],
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

stubDom();

// 1) 基础布局
let content = baseContent();
let layout = layoutMindmap(content);
assert(layout.nodes.length === 4, `balanced 布局节点数=4（实际 ${layout.nodes.length}）`);

const rootNode = layout.nodes.find((node) => node.id === "topic-root0001");
assert(Boolean(rootNode && Math.abs(rootNode.x + rootNode.width / 2) < 1), "根主题以原点为中心");

// 单根主题：水平与垂直中心都在原点，内容变化不会把中心推走
const singleRoot = layoutMindmap({
  ...baseContent(),
  sheet: { ...baseContent().sheet, root: topic("topic-root0001", "根") },
}).nodes.find((node) => node.id === "topic-root0001");
assert(
  Boolean(
    singleRoot &&
      Math.abs(singleRoot.x + singleRoot.width / 2) < 1 &&
      Math.abs(singleRoot.y + singleRoot.height / 2) < 1,
  ),
  "单根主题中心在原点",
);

// 1.1) 元信息计入宽高：chip 溢出曾把标题顶出节点并被画布裁掉
const decoratedRoot = layoutMindmap(
  updateTopic(baseContent(), "topic-root0001", (item) => ({
    ...item,
    labels: ["灵感", "待办", "复盘"],
    note: "备注",
    link: "https://example.com",
    markers: ["priority-1", "week-mon"],
    stickers: ["idea"],
  })),
).nodes.find((node) => node.id === "topic-root0001");
assert(Boolean(rootNode && decoratedRoot && decoratedRoot.height > rootNode.height), "元信息撑高主题");
assert(Boolean(rootNode && decoratedRoot && decoratedRoot.width > rootNode.width), "元信息撑宽主题");

// 1.2) 元信息多到换行时继续增高，不能溢出节点
const crowdedRoot = layoutMindmap(
  updateTopic(baseContent(), "topic-root0001", (item) => ({
    ...item,
    labels: Array.from({ length: 12 }, (_, index) => `标签${index}`),
    markers: Array.from({ length: 12 }, (_, index) => `priority-${(index % 6) + 1}`),
    stickers: ["check", "idea", "warning", "flame", "target", "pin", "heart", "thumb"],
  })),
).nodes.find((node) => node.id === "topic-root0001");
assert(
  Boolean(decoratedRoot && crowdedRoot && crowdedRoot.height > decoratedRoot.height),
  "元信息换行继续撑高主题",
);

// 1.3) 外链协议白名单（系统浏览器只接收安全协议）
assert(safeExternalUrl(" https://xmind.app ") === "https://xmind.app", "外链允许 https 并去空格");
assert(safeExternalUrl("mailto:a@b.com") === "mailto:a@b.com", "外链允许 mailto");
assert(safeExternalUrl("javascript:alert(1)") === null, "外链拒绝 javascript");
assert(safeExternalUrl("file:///etc/passwd") === null, "外链拒绝 file");
assert(safeExternalUrl("") === null, "外链拒绝空串");

// 2) 自由主题参与布局并带 free 标记
content = addFreeTopic(content, createTopic("浮动"), { x: 400, y: 100 });
layout = layoutMindmap(content);
const free = layout.nodes.find((node) => node.topic.text === "浮动");
assert(Boolean(free?.free), "自由主题进入布局并标记 free");

// 3) 自由主题删除后清理关系线
content = addRelationship(content, "topic-child001", "topic-child002");
assert((content.relationships ?? []).length === 1, "关系线已添加");
content = removeFreeTopic(content, free?.id ?? "") ?? content;
assert(layoutMindmap(content).nodes.length === 4, "删除自由主题后回到 4 个节点");

// 4) 手动坐标覆盖自动布局
content = setTopicPos(content, "topic-child002", { x: 500, y: -50 }) ?? content;
layout = layoutMindmap(content);
const moved = layout.nodes.find((node) => node.id === "topic-child002");
assert(Boolean(moved && Math.round(moved.x) === 500 && Math.round(moved.y) === -50), "手动坐标生效");

for (const structure of ["org-down", "timeline", "fishbone"] as const) {
  let structured: MindmapContent = {
    ...baseContent(),
    sheet: { ...baseContent().sheet, structure },
  };
  structured = setTopicPos(structured, "topic-child001", { x: 640, y: 320 }) ?? structured;
  const placed = layoutMindmap(structured).nodes.find((node) => node.id === "topic-child001");
  assert(Boolean(placed && placed.x === 640 && placed.y === 320), `${structure} 手动坐标生效`);
}

const childBefore = layoutMindmap(baseContent()).nodes.find((node) => node.id === "topic-child001");
const rootBefore = layoutMindmap(baseContent()).nodes.find((node) => node.id === "topic-root0001");
let rootShifted = setTopicPos(baseContent(), "topic-root0001", { x: 1000, y: 400 }) ?? baseContent();
const childAfter = layoutMindmap(rootShifted).nodes.find((node) => node.id === "topic-child001");
// 根自动位置是以原点为中心的左上角（-宽/2），子树位移 = 目标坐标 - 原自动坐标。
const childShift = 1000 - (rootBefore?.x ?? 0);
assert(
  Boolean(childBefore && childAfter && Math.round(childAfter.x - childBefore.x) === Math.round(childShift)),
  "根主题手动坐标带动子树",
);

// 5) 重新排列清除手动坐标
content = clearTopicPositions(content);
layout = layoutMindmap(content);
const reflowed = layout.nodes.find((node) => node.id === "topic-child002");
assert(Boolean(reflowed && Math.round(reflowed.x) !== 500), "重新排列清除手动坐标");

// 5.1) 概要主题可手动定位，并在重新排列时清除
let summaryContent = addSummary(
  baseContent(),
  "topic-root0001",
  ["topic-child001", "topic-child002"],
  createTopic("结论"),
);
const summaryTopicId = summaryContent.summaries?.[0]?.topic.id ?? "";
summaryContent = setTopicPos(summaryContent, summaryTopicId, { x: 900, y: 700 }) ?? summaryContent;
const summaryNode = layoutMindmap(summaryContent).nodes.find((node) => node.id === summaryTopicId);
assert(Boolean(summaryNode && summaryNode.x === 900 && summaryNode.y === 700), "概要主题手动坐标生效");
summaryContent = clearTopicPositions(summaryContent);
const summaryAuto = layoutMindmap(summaryContent).nodes.find((node) => node.id === summaryTopicId);
assert(Boolean(summaryAuto && summaryAuto.x !== 900), "重新排列清除概要主题坐标");

// 6) 同父排序
content = reorderSibling(content, "topic-child003", 0) ?? content;
const order = (content.sheet.root.children ?? []).map((item) => item.id);
assert(order[0] === "topic-child003", `同级排序生效（${order.join(",")}）`);

// 7) moveSibling 边界不越界
assert(moveSibling(content, "topic-child003", -1) === null, "首位继续上移返回 null");

// 8) 拖拽落点：相交 → 换父；邻近兄弟 → 排序；空白 → 手动位置；自由主题相交 → 吸附
layout = layoutMindmap(content);
let decision = resolveDrop({
  content,
  layoutNodes: layout.nodes,
  draggedId: "topic-child001",
  draggedPosition: { x: 0, y: 0 },
  intersectingIds: ["topic-child002"],
});
assert(decision.kind === "reparent" && decision.targetId === "topic-child002", "相交时换父");

const sibling = layout.nodes.find((node) => node.id === "topic-child003");
decision = resolveDrop({
  content,
  layoutNodes: layout.nodes,
  draggedId: "topic-child001",
  draggedPosition: { x: (sibling?.x ?? 0) - 40, y: sibling?.y ?? 0 },
  intersectingIds: [],
});
assert(decision.kind === "reorder", `无相交且靠近兄弟时排序（实际 ${decision.kind}）`);

decision = resolveDrop({
  content,
  layoutNodes: layout.nodes,
  draggedId: "topic-child001",
  draggedPosition: { x: 2000, y: 2000 },
  intersectingIds: [],
});
assert(decision.kind === "move", "远离任何兄弟时记录手动位置");

content = addFreeTopic(content, createTopic("浮动2"), { x: 900, y: 900 });
layout = layoutMindmap(content);
const freeId = layout.nodes.find((node) => node.topic.text === "浮动2")?.id ?? "";
decision = resolveDrop({
  content,
  layoutNodes: layout.nodes,
  draggedId: freeId,
  draggedPosition: { x: 0, y: 0 },
  intersectingIds: ["topic-child002"],
});
assert(decision.kind === "freeAttach", "自由主题相交时走吸附分支");

// 9) 关系线绕行：在两端之间放一个节点，路径应变成二次曲线（Q）
content = {
  ...baseContent(),
  relationships: [{ id: "rel-00000001", from: "topic-child001", to: "topic-child002", label: "", color: "auto" }],
};
content = setTopicPos(content, "topic-child001", { x: -400, y: 0 }) ?? content;
content = setTopicPos(content, "topic-child002", { x: 400, y: 0 }) ?? content;
content = setTopicPos(content, "topic-child003", { x: 0, y: 0 }) ?? content;
layout = layoutMindmap(content);
const relation = layout.relationships[0];
assert(Boolean(relation?.path.includes("Q")), "直线被遮挡时关系线绕行为曲线");

// 10) 外框/概要几何命中：装饰层不接收指针事件，点空白处也要能选中
const frameLayout: MindmapLayout = {
  nodes: [],
  edges: [],
  relationships: [],
  summaries: [{ id: "sum1", x: 5, y: 5, width: 20, height: 40, direction: "right" }],
  boundaries: [{ id: "bd1", x: 10, y: 10, width: 100, height: 80, memberIds: [] }],
  width: 0,
  height: 0,
};
assert(hitTestFrame(frameLayout, { x: 6, y: 6 }) === "sum1", "概要括号优先命中");
assert(hitTestFrame(frameLayout, { x: 50, y: 50 }) === "bd1", "外框内部命中");
assert(hitTestFrame(frameLayout, { x: 400, y: 400 }) === null, "框外不命中");

// 11) 方向导航：目标方向没有节点时返回 null，而不是乱选
const navTopic = (id: string) => topic(id, id);
const navNodes: MindmapLayout["nodes"] = [
  {
    id: "a",
    x: 0,
    y: 0,
    width: 80,
    height: 30,
    depth: 0,
    side: "root",
    branchIndex: 0,
    hiddenCount: 0,
    topic: navTopic("a"),
  },
  {
    id: "b",
    x: 0,
    y: 100,
    width: 80,
    height: 30,
    depth: 1,
    side: "down",
    branchIndex: 0,
    hiddenCount: 0,
    topic: navTopic("b"),
  },
];
assert(pickDirectionalNode(navNodes, "a", "down")?.id === "b", "方向导航选到下方节点");
assert(pickDirectionalNode(navNodes, "a", "up") === null, "上方无节点时返回 null");
assert(pickDirectionalNode(navNodes, "a", "right") === null, "右侧无节点时返回 null");

// 12) SVG 导出与画布语义一致：关系线/外框/概要/主题样式/编号
let exportContent = baseContent();
exportContent = addBoundary(
  exportContent,
  "topic-root0001",
  ["topic-child001", "topic-child002"],
  "分组",
);
exportContent = addSummary(
  exportContent,
  "topic-root0001",
  ["topic-child001", "topic-child002"],
  createTopic("结论"),
);
exportContent = addRelationship(exportContent, "topic-child001", "topic-child003");
exportContent =
  updateTopic(exportContent, "topic-child001", (item) => ({
    ...item,
    style: { borderColor: "#e07a5f", borderWidth: "bold", fill: "none", borderShape: "pill" },
  })) ?? exportContent;
exportContent = { ...exportContent, sheet: { ...exportContent.sheet, showNumbers: true } };
const svg = renderMindmapSvg(exportContent, "导出", new Map(), {
  background: "#ffffff",
  card: "#ffffff",
  foreground: "#111111",
  muted: "#777777",
  border: "#cccccc",
  branches: ["#3d8a7e"],
});
assert(svg.includes('stroke-dasharray="7 5"'), "SVG 导出包含关系线");
assert(svg.includes('stroke-dasharray="6 4"'), "SVG 导出包含外框");
assert(svg.includes('stroke-width="2.6"'), "SVG 导出沿用主题边框粗细");
assert(svg.includes("结论"), "SVG 导出包含概要主题");
assert(svg.includes(">1</text>"), "SVG 导出包含自动编号");

console.log("思维导图纯逻辑烟雾测试通过");
