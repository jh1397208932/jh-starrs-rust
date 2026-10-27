import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Edge,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MindmapContent, MindmapEdgeStyle, MindmapFile, MindmapLayout } from "@/types/mindmap";
import { useMindmapFlowViewport } from "../hooks/useMindmapFlowViewport";
import { resolveDrop } from "../utils/dropTarget";
import { buildFlowNodes } from "../utils/flowNodes";
import { hitTestFrame } from "../utils/frameHit";
import { MindmapEdge } from "./MindmapEdge";
import { MindmapFrameNode } from "./MindmapFrameNode";
import { MindmapRelationshipEdge } from "./MindmapRelationEdges";
import { MindmapTopicNode } from "./MindmapTopicNode";

interface MindmapCanvasProps {
  nodeId: string;
  content: MindmapContent;
  layout: MindmapLayout;
  selectedId: string | null;
  selectedFrameId: string | null;
  selectedRelationshipId: string | null;
  editingId: string | null;
  images: Map<string, MindmapFile>;
  focusTarget: { id: string; token: number } | null;
  onSelectionChange: (id: string | null, additive?: boolean) => void;
  onRelationshipSelect: (id: string | null) => void;
  onFrameSelect: (id: string) => void;
  onStartEdit: (id: string | null) => void;
  onCommitText: (id: string, text: string) => void;
  onToggleCollapsed: (id: string) => void;
  onMoveUnder: (sourceId: string, targetId: string) => void;
  onSetPosition: (id: string, pos: { x: number; y: number }) => void;
  onReorder: (id: string, targetIndex: number) => void;
  onFreeAttach: (freeId: string, targetId: string) => void;
  onViewportChange: (viewport: { x: number; y: number; zoom: number }) => void;
  initialViewport: { x: number; y: number; zoom: number } | null;
}

const nodeTypes = {
  mindmapTopic: MindmapTopicNode,
  mindmapFrame: MindmapFrameNode,
};
const edgeTypes = { mindmap: MindmapEdge, mindmapRelation: MindmapRelationshipEdge };

/** React Flow 画布适配层；树语义仍由父组件持有。 */
export function MindmapCanvas(props: MindmapCanvasProps) {
  return (
    <ReactFlowProvider>
      <MindmapCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function MindmapCanvasInner({
  nodeId,
  content,
  layout,
  selectedId,
  selectedFrameId,
  selectedRelationshipId,
  editingId,
  images,
  focusTarget,
  onSelectionChange,
  onRelationshipSelect,
  onFrameSelect,
  onStartEdit,
  onCommitText,
  onToggleCollapsed,
  onMoveUnder,
  onSetPosition,
  onReorder,
  onFreeAttach,
  onViewportChange,
  initialViewport,
}: MindmapCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [dragPositions, setDragPositions] = useState<Map<string, XYPosition>>(new Map());
  const { getIntersectingNodes, screenToFlowPosition } = useReactFlow();
  const edgeStyle: MindmapEdgeStyle = content.sheet.edgeStyle ?? "curve";
  const background = content.sheet.background ?? "dots";

  const edges = useMemo<Edge[]>(() => {
    const treeEdges: Edge[] = layout.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "mindmap",
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: { branchIndex: edge.branchIndex, depth: edge.depth, edgeStyle },
      selectable: false,
    }));
    const relationEdges: Edge[] = (content.relationships ?? []).map((relationship) => ({
      id: `relationship:${relationship.id}`,
      source: relationship.from,
      target: relationship.to,
      type: "mindmapRelation",
      data: (() => {
        const geometry = layout.relationships.find((item) => item.id === relationship.id);
        return {
          label: relationship.label,
          color: relationship.color,
          path: geometry?.path,
          fromX: geometry?.fromX,
          fromY: geometry?.fromY,
          toX: geometry?.toX,
          toY: geometry?.toY,
        };
      })(),
      selectable: true,
      selected: selectedRelationshipId === relationship.id,
      zIndex: 1,
    }));
    return [...treeEdges, ...relationEdges];
  }, [content.relationships, edgeStyle, layout.edges, layout.relationships, selectedRelationshipId]);

  useEffect(() => {
    setNodes(
      buildFlowNodes({
        layout,
        dragPositions,
        selectedId,
        selectedFrameId,
        editingId,
        images,
        onCommitText,
        onStartEdit,
        onToggleCollapsed,
      }),
    );
  }, [
    dragPositions,
    editingId,
    images,
    layout,
    onCommitText,
    onStartEdit,
    onToggleCollapsed,
    selectedFrameId,
    selectedId,
  ]);

  useMindmapFlowViewport({
    nodeId,
    initialViewport,
    focusTarget,
    layoutNodes: layout.nodes,
  });

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) =>
      applyNodeChanges(
        changes.filter((change) => change.type !== "position"),
        current,
      ),
    );
  }, []);

  const onNodeDrag = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    setDragPositions((current) => new Map(current).set(node.id, node.position));
  }, []);

  const onNodeDragStop = useCallback(
    (_: MouseEvent | TouchEvent, dragged: Node) => {
      setDragPositions((current) => {
        const next = new Map(current);
        next.delete(dragged.id);
        return next;
      });
      const decision = resolveDrop({
        content,
        layoutNodes: layout.nodes,
        draggedId: dragged.id,
        draggedPosition: dragged.position,
        intersectingIds: getIntersectingNodes(dragged, false)
          .filter((candidate) => candidate.type === "mindmapTopic")
          .map((candidate) => candidate.id),
      });
      if (decision.kind === "reparent") onMoveUnder(dragged.id, decision.targetId);
      else if (decision.kind === "freeAttach") onFreeAttach(dragged.id, decision.targetId);
      else if (decision.kind === "reorder") onReorder(dragged.id, decision.index);
      else onSetPosition(dragged.id, decision.position);
    },
    [content, getIntersectingNodes, layout.nodes, onFreeAttach, onMoveUnder, onReorder, onSetPosition],
  );

  return (
    <div
      className="mindmap-canvas"
      data-structure={content.sheet.structure}
      data-theme={content.sheet.theme}
      data-coloring={content.sheet.branchColoring ?? "theme"}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(event, node) => {
          onRelationshipSelect(null);
          if (node.type === "mindmapFrame") {
            onSelectionChange(null);
            onFrameSelect(node.id.replace("frame:", ""));
            return;
          }
          onSelectionChange(node.id, event.shiftKey);
          onStartEdit(null);
        }}
        onNodeDoubleClick={(_, node) => onStartEdit(node.id)}
        onPaneClick={(event) => {
          onRelationshipSelect(null);
          onStartEdit(null);
          // 外框/括号不接收指针事件：用流坐标做几何命中，点空白处也能选中它们。
          const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
          const frameId = hitTestFrame(layout, point);
          if (frameId) {
            onSelectionChange(null);
            onFrameSelect(frameId);
            return;
          }
          onSelectionChange(null);
        }}
        onEdgeClick={(_, edge) => {
          if (edge.type === "mindmapRelation") {
            onSelectionChange(null);
            onRelationshipSelect(edge.id.replace("relationship:", ""));
          }
        }}
        onMoveEnd={(_, viewport) => onViewportChange(viewport)}
        minZoom={0.12}
        maxZoom={3}
        nodesConnectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionOnDrag={false}
        proOptions={{ hideAttribution: true }}
      >
        {background === "plain" ? null : (
          <Background
            variant={background === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={background === "grid" ? 28 : 20}
            size={1}
            color="var(--mindmap-grid)"
          />
        )}
      </ReactFlow>
    </div>
  );
}
