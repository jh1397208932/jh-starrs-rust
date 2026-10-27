import {
  Background,
  BackgroundVariant,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 拖拽位置交给 React Flow 自己维护：每帧不再重建整批节点，保证 60fps。
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // 入场动画只给首次出现的节点：onlyRenderVisibleElements 会在平移时重挂节点，
  // 若动画常驻会在每次重挂时重播，看起来像闪烁。
  const enteredIdsRef = useRef<Set<string>>(new Set());
  const enterTimerRef = useRef<number | null>(null);
  const { getIntersectingNodes, screenToFlowPosition } = useReactFlow();
  const edgeStyle: MindmapEdgeStyle = content.sheet.edgeStyle ?? "curve";
  const background = content.sheet.background ?? "dots";

  // 回调放进 ref：节点只在布局/选择/编辑变化时重建，父组件保存状态刷新不触发重建。
  const callbacksRef = useRef({ onCommitText, onStartEdit, onToggleCollapsed });
  callbacksRef.current = { onCommitText, onStartEdit, onToggleCollapsed };
  const stableCallbacks = useMemo(
    () => ({
      onCommitText: (id: string, text: string) => callbacksRef.current.onCommitText(id, text),
      onStartEdit: (id: string) => callbacksRef.current.onStartEdit(id),
      onToggleCollapsed: (id: string) => callbacksRef.current.onToggleCollapsed(id),
    }),
    [],
  );

  useEffect(() => {
    const built = buildFlowNodes({
      layout,
      selectedId,
      selectedFrameId,
      editingId,
      images,
      ...stableCallbacks,
    });
    const fresh = new Set<string>();
    for (const node of built) {
      if (enteredIdsRef.current.has(node.id)) continue;
      enteredIdsRef.current.add(node.id);
      fresh.add(node.id);
    }
    setNodes(
      fresh.size > 0
        ? built.map((node) => (fresh.has(node.id) ? { ...node, className: "mindmap-node-enter" } : node))
        : built,
    );
    if (fresh.size > 0) {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        setNodes((current) =>
          current.some((node) => node.className)
            ? current.map((node) => (node.className ? { ...node, className: undefined } : node))
            : current,
        );
      }, 240);
    }
  }, [editingId, images, layout, selectedFrameId, selectedId, setNodes, stableCallbacks]);

  useEffect(
    () => () => {
      if (enterTimerRef.current !== null) window.clearTimeout(enterTimerRef.current);
    },
    [],
  );

  const { markUserMoved } = useMindmapFlowViewport({
    nodeId,
    initialViewport,
    focusTarget,
    layoutNodes: layout.nodes,
    containerRef,
  });

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

  const onNodeDragStop = useCallback(
    (_: MouseEvent | TouchEvent, dragged: Node) => {
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
    <div ref={containerRef} className="mindmap-canvas" data-structure={content.sheet.structure}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onMoveStart={(event) => {
          if (event) markUserMoved();
        }}
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
        onlyRenderVisibleElements
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
