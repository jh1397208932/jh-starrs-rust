import { BaseEdge, type EdgeProps, getBezierPath, getSmoothStepPath } from "@xyflow/react";

/** 思维导图父子连线：曲线/折线随画布设置，粗细随层级衰减，颜色按一级分支取色。 */
export function MindmapEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const payload = (data ?? {}) as {
    branchIndex?: number;
    depth?: number;
    edgeStyle?: "curve" | "polyline";
  };
  const branchIndex = Number(payload.branchIndex ?? 0);
  const depth = Number(payload.depth ?? 1);
  const options = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };
  const [path] =
    payload.edgeStyle === "polyline"
      ? getSmoothStepPath({ ...options, borderRadius: 8 })
      : getBezierPath({ ...options, curvature: 0.28 });
  const gradientId = `mindmap-edge-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  const color = `var(--mindmap-branch-${branchIndex % 6})`;
  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={0.55} />
        </linearGradient>
      </defs>
      <BaseEdge
        id={id}
        path={path}
        className={selected ? "mindmap-edge is-selected" : "mindmap-edge"}
        style={{
          stroke: `url(#${gradientId})`,
          strokeWidth: Math.max(1.25, 3 - depth * 0.35),
        }}
      />
    </>
  );
}
