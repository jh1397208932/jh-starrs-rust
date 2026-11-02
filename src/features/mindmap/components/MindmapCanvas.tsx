import {
  Background,
  BackgroundVariant,
  getBezierPath,
  getSmoothStepPath,
  type Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  ViewportPortal,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import type {
  ConnectorSide,
  MindmapContent,
  MindmapEdgeStyle,
  MindmapFile,
  MindmapLayout,
} from "@/types/mindmap";
import { useMindmapFlowViewport } from "../hooks/useMindmapFlowViewport";
import { buildTreeConnectors } from "../utils/connectors";
import { resolveDrop } from "../utils/dropTarget";
import { buildFlowNodes } from "../utils/flowNodes";
import { hitTestFrame } from "../utils/frameHit";
import { MindmapFrameNode } from "./MindmapFrameNode";
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
// 自绘连线把方向映射成 React Flow 的曲线锚点，保证与旧 edge 的曲率一致。
const POSITION_BY_SIDE: Record<ConnectorSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  up: Position.Top,
  down: Position.Bottom,
};

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
  // 正在拖拽的节点：重建节点时保留 React Flow 的实时坐标，
  // 否则拖拽中因选中态变化触发的重建会把节点拉回布局旧位置（表现为“只在拖动前后生效”）。
  const draggingIdRef = useRef<string | null>(null);
  const { getIntersectingNodes, screenToFlowPosition } = useReactFlow();
  const { t } = useI18n();
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
    setNodes((current) => {
      const livePositions = new Map(current.map((node) => [node.id, node.position]));
      const next =
        fresh.size > 0
          ? built.map((node) => (fresh.has(node.id) ? { ...node, className: "mindmap-node-enter" } : node))
          : built;
      const draggingId = draggingIdRef.current;
      if (!draggingId) return next;
      return next.map((node) => {
        if (node.id !== draggingId) return node;
        const live = livePositions.get(node.id);
        return live ? { ...node, position: live } : node;
      });
    });
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

  // 连线自绘：端点只由布局坐标决定，节点不在视口内也照样画（React Flow 的 edge 通道会静默丢线）。
  const treePaths = useMemo(
    () =>
      buildTreeConnectors(layout).map((connector) => {
        const options = {
          sourceX: connector.source.x,
          sourceY: connector.source.y,
          sourcePosition: POSITION_BY_SIDE[connector.source.side],
          targetX: connector.target.x,
          targetY: connector.target.y,
          targetPosition: POSITION_BY_SIDE[connector.target.side],
        };
        const [path] =
          edgeStyle === "polyline"
            ? getSmoothStepPath({ ...options, borderRadius: 8 })
            : getBezierPath({ ...options, curvature: 0.28 });
        return {
          id: connector.id,
          path,
          branchIndex: connector.branchIndex,
          depth: connector.depth,
        };
      }),
    [edgeStyle, layout],
  );

  const relationPaths = useMemo(
    () =>
      layout.relationships.map((relationship) => ({
        id: relationship.id,
        path: relationship.path,
        label: relationship.label,
        labelX: (relationship.fromX + relationship.toX) / 2,
        labelY: (relationship.fromY + relationship.toY) / 2,
        color:
          relationship.color && relationship.color !== "auto"
            ? relationship.color
            : "var(--mindmap-relation)",
        selected: selectedRelationshipId === relationship.id,
      })),
    [layout.relationships, selectedRelationshipId],
  );

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
      // 先结束“拖拽中”标记，再提交落位：随后的布局刷新才允许把节点放到新位置。
      draggingIdRef.current = null;
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
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={(_, node) => {
          draggingIdRef.current = node.id;
        }}
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
        <ViewportPortal>
          <svg className="mindmap-connectors" aria-hidden="true">
            {treePaths.map((treePath) => (
              <path
                key={treePath.id}
                d={treePath.path}
                className="mindmap-edge"
                stroke={`var(--mindmap-branch-${treePath.branchIndex % 6})`}
                strokeWidth={Math.max(1.25, 3 - treePath.depth * 0.35)}
              />
            ))}
            {relationPaths.map((relation) => {
              const selectRelation = () => {
                onSelectionChange(null);
                onRelationshipSelect(relation.id);
              };
              return (
                <g key={relation.id}>
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG 笔画不能换成 <button>；键盘可达性已由 role+tabIndex+onKeyDown 承担 */}
                  <path
                    d={relation.path}
                    className={relation.selected ? "mindmap-relation is-selected" : "mindmap-relation"}
                    stroke={relation.color}
                    role="button"
                    tabIndex={0}
                    aria-label={relation.label || t("关系线")}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectRelation();
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      selectRelation();
                    }}
                  />
                  {relation.label ? (
                    <foreignObject
                      className="mindmap-relation__label-box"
                      requiredExtensions="http://www.w3.org/1999/xhtml"
                      x={relation.labelX - 100}
                      y={relation.labelY - 12}
                      width={200}
                      height={24}
                    >
                      <div
                        className={
                          relation.selected
                            ? "mindmap-relation__label is-selected"
                            : "mindmap-relation__label"
                        }
                        style={{ borderColor: relation.color }}
                      >
                        {relation.label}
                      </div>
                    </foreignObject>
                  ) : (
                    <circle
                      cx={relation.labelX}
                      cy={relation.labelY}
                      r={3}
                      fill={relation.color}
                      opacity={relation.selected ? 1 : 0.55}
                    />
                  )}
                  <title>{t("关系线")}</title>
                </g>
              );
            })}
          </svg>
        </ViewportPortal>
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
