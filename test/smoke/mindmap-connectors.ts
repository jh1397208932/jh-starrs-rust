/**
 * 连接线几何烟雾测试（Node 运行，无需窗口）。
 *
 * 需求：每条父子边都必须有端点对，且端点落在节点边框上——不管什么结构、节点在不在视口内。
 * 历史缺陷：线走 React Flow 的 edge 通道，端点节点未测量（视口外）或 handle id 不存在时
 * 整条线被静默丢弃，表现就是"节点一多有些线自动消失"。
 */

import { buildTreeConnectors, endpointOf } from "@/features/mindmap/utils/connectors";
import { layoutMindmap } from "@/features/mindmap/utils/layout";
import { clearMeasureCache } from "@/features/mindmap/utils/measure";
import type { MindmapContent, MindmapStructure, MindmapTopic } from "@/types/mindmap";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

/** measure.ts 用隐藏 span 量宽；这里按字符数给桩，只关心几何结构不看真实字宽。 */
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

/** 三层树：覆盖左右分支、孙节点与叶子。 */
function sampleRoot(): MindmapTopic {
  return topic("topic-root", "根", [
    topic("topic-a", "甲", [
      topic("topic-a1", "甲一"),
      topic("topic-a2", "甲二", [topic("topic-a2x", "甲二甲")]),
    ]),
    topic("topic-b", "乙", [topic("topic-b1", "乙一")]),
    topic("topic-c", "丙"),
  ]);
}

function contentOf(structure: MindmapStructure): MindmapContent {
  return {
    schemaVersion: 2,
    sheet: { id: "sheet-connectors", structure, theme: "vivid", root: sampleRoot() },
  };
}

/** 端点是否落在节点边框上（带 0.01px 容差）。 */
function onBorder(
  node: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  const near = (left: number, right: number) => Math.abs(left - right) < 0.01;
  const withinX = point.x >= node.x - 0.01 && point.x <= node.x + node.width + 0.01;
  const withinY = point.y >= node.y - 0.01 && point.y <= node.y + node.height + 0.01;
  const onVertical = (near(point.x, node.x) || near(point.x, node.x + node.width)) && withinY;
  const onHorizontal = (near(point.y, node.y) || near(point.y, node.y + node.height)) && withinX;
  return onVertical || onHorizontal;
}

stubDom();

const structures: MindmapStructure[] = [
  "balanced",
  "logic-right",
  "logic-left",
  "org-down",
  "org-up",
  "tree",
  "timeline",
  "fishbone",
];

for (const structure of structures) {
  clearMeasureCache();
  const layout = layoutMindmap(contentOf(structure));
  const connectors = buildTreeConnectors(layout);
  const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));

  assert(
    connectors.length === layout.edges.length,
    `${structure}：${layout.edges.length} 条父子边全部生成端点对（实际 ${connectors.length}）`,
  );
  assert(
    new Set(connectors.map((connector) => connector.id)).size === connectors.length,
    `${structure}：端点对 id 不重复`,
  );

  for (const edge of layout.edges) {
    const connector = connectors.find((item) => item.id === edge.id);
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    assert(
      Boolean(connector) && Boolean(source) && Boolean(target),
      `${structure}：边 ${edge.id} 的两端节点与端点对都存在`,
    );
    if (!connector || !source || !target) continue;
    assert(
      onBorder(source, connector.source) && onBorder(target, connector.target),
      `${structure}：边 ${edge.id} 的端点落在两端节点边框上`,
    );
    assert(
      [connector.source.x, connector.source.y, connector.target.x, connector.target.y].every((value) =>
        Number.isFinite(value),
      ),
      `${structure}：边 ${edge.id} 的端点坐标是有限数`,
    );
  }
}

assert(
  endpointOf({ x: 10, y: 20, width: 100, height: 40 }, "down").y === 60,
  "down 方向锚点取节点底边",
);

console.log("连接线几何烟雾测试通过");
