/**
 * 连接线端点换算：只由布局结果推导，与 React Flow 的节点测量、视口可见性无关。
 *
 * 历史缺陷：父子线走 React Flow 的 edge 通道，端点节点一旦不在视口内就没有测量结果，
 * `getEdgePosition` 返回 null，整条线被静默丢弃；时间线/鱼骨/向上 org 还引用了节点上
 * 不存在的 handle id，同样静默不画。改为自绘 SVG 后，端点只取决于布局坐标。
 */

import type { ConnectorSide, MindmapLayout } from "@/types/mindmap";

/** 连线端点：布局坐标 + 方向。 */
export interface ConnectorEndpoint {
  x: number;
  y: number;
  side: ConnectorSide;
}

/** 一条父子连线的端点对。 */
export interface TreeConnector {
  id: string;
  source: ConnectorEndpoint;
  target: ConnectorEndpoint;
  branchIndex: number;
  depth: number;
}

/**
 * 计算节点某一方向的连线端点（节点边框上的锚点）。
 * @param node 布局节点（含 x/y/width/height）
 * @param side 布局给出的出/入方向
 * @returns 锚点坐标与方向
 * @example endpointOf({x:0,y:0,width:100,height:40}, "right") // { x: 100, y: 20, side: "right" }
 */
export function endpointOf(
  node: { x: number; y: number; width: number; height: number },
  side: ConnectorSide,
): ConnectorEndpoint {
  const midX = node.x + node.width / 2;
  const midY = node.y + node.height / 2;
  switch (side) {
    case "left":
      return { x: node.x, y: midY, side };
    case "right":
      return { x: node.x + node.width, y: midY, side };
    case "up":
      return { x: midX, y: node.y, side };
    default:
      return { x: midX, y: node.y + node.height, side };
  }
}

/**
 * 把布局里的全部父子边换算成端点对。
 *
 * 端点节点缺失（异常数据）时跳过该条，但不会因为「没有测量尺寸」而丢线——
 * 布局节点自带宽高，画布外也一样能算。
 * @param layout 布局结果
 * @returns 连线端点对，顺序与 layout.edges 一致
 */
export function buildTreeConnectors(layout: MindmapLayout): TreeConnector[] {
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const connectors: TreeConnector[] = [];
  for (const edge of layout.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    connectors.push({
      id: edge.id,
      source: endpointOf(source, edge.sourceHandle),
      target: endpointOf(target, edge.targetHandle),
      branchIndex: edge.branchIndex,
      depth: edge.depth,
    });
  }
  return connectors;
}
