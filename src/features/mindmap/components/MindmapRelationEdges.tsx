import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useI18n } from "@/lib/i18n";

/** 关系线：虚线曲线 + 端点箭头 + 可点击标签；颜色 auto 时用中性强调色。 */
export function MindmapRelationshipEdge({
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
  const { t } = useI18n();
  const payload = (data ?? {}) as {
    label?: string;
    color?: string;
    path?: string;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;
  };
  const computed = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.4,
  });
  const path = payload.path ?? computed[0];
  const labelX =
    payload.fromX !== undefined && payload.toX !== undefined
      ? (payload.fromX + payload.toX) / 2
      : computed[1];
  const labelY =
    payload.fromY !== undefined && payload.toY !== undefined
      ? (payload.fromY + payload.toY) / 2
      : computed[2];
  const color = payload.color && payload.color !== "auto" ? payload.color : "var(--mindmap-relation)";
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={selected ? "mindmap-relation is-selected" : "mindmap-relation"}
        style={{ stroke: color }}
      />
      {payload.label ? (
        <foreignObject
          className="mindmap-relation__label-box"
          requiredExtensions="http://www.w3.org/1999/xhtml"
          x={labelX - 100}
          y={labelY - 12}
          width={200}
          height={24}
        >
          <div
            className={selected ? "mindmap-relation__label is-selected" : "mindmap-relation__label"}
            style={{ borderColor: color }}
          >
            {payload.label}
          </div>
        </foreignObject>
      ) : (
        <circle cx={labelX} cy={labelY} r={3} fill={color} opacity={selected ? 1 : 0.55} />
      )}
      <title>{t("关系线")}</title>
    </>
  );
}
