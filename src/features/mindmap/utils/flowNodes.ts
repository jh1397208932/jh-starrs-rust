/**
 * 由布局结果构建 React Flow 节点数组：外框/概要图层在前，主题节点在后。
 */

import type { Node } from "@xyflow/react";
import type { MindmapFile, MindmapLayout } from "@/types/mindmap";
import type { MindmapFrameData } from "../components/MindmapFrameNode";
import type { MindmapNodeData } from "../components/MindmapTopicNode";

export interface FlowNodesParams {
  layout: MindmapLayout;
  selectedId: string | null;
  selectedFrameId?: string | null;
  editingId: string | null;
  images: Map<string, MindmapFile>;
  onCommitText: (id: string, text: string) => void;
  onStartEdit: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
}

/** 生成节点数组；顺序即层级（外框在底层）。 */
export function buildFlowNodes(params: FlowNodesParams): Node[] {
  const {
    layout,
    selectedId,
    selectedFrameId,
    editingId,
    images,
    onCommitText,
    onStartEdit,
    onToggleCollapsed,
  } = params;
  const frameNodes: Node[] = [];
  for (const boundary of layout.boundaries) {
    const data: MindmapFrameData = {
      kind: "boundary",
      label: boundary.label,
      color: boundary.color,
    };
    frameNodes.push({
      id: `frame:${boundary.id}`,
      type: "mindmapFrame",
      position: { x: boundary.x, y: boundary.y },
      width: boundary.width,
      height: boundary.height,
      data,
      selected: selectedFrameId === boundary.id,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { width: boundary.width, height: boundary.height, pointerEvents: "none" },
    });
  }
  for (const summary of layout.summaries) {
    const data: MindmapFrameData = {
      kind: "summary-bracket",
      color: undefined,
      direction: summary.direction,
    };
    frameNodes.push({
      id: `frame:${summary.id}`,
      type: "mindmapFrame",
      position: { x: summary.x, y: summary.y },
      width: summary.width,
      height: summary.height,
      data,
      selected: selectedFrameId === summary.id,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
      style: { width: summary.width, height: summary.height, pointerEvents: "none" },
    });
  }
  const next = [
    ...frameNodes,
    ...layout.nodes.map((node) => {
      const position = { x: node.x, y: node.y };
      const data: MindmapNodeData = {
        topic: node.topic,
        isRoot: node.depth === 0,
        depth: node.depth,
        side: node.side,
        editing: editingId === node.id,
        hiddenCount: node.hiddenCount,
        branchIndex: node.branchIndex,
        number: node.number,
        free: node.free ?? false,
        imageUrl: node.topic.image ? images.get(node.topic.image.objectId)?.dataUrl : undefined,
        onCommitText,
        onStartEdit: (id) => onStartEdit(id),
        onToggleCollapsed,
      };
      return {
        id: node.id,
        type: "mindmapTopic",
        position,
        width: node.width,
        height: node.height,
        selected: selectedId === node.id,
        draggable: true,
        data,
        style: { width: node.width, height: node.height },
      } satisfies Node;
    }),
  ];
  return next;
}
