import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useI18n } from "@/lib/i18n";

export interface MindmapFrameData extends Record<string, unknown> {
  label?: string;
  color?: string;
  /** boundary = 圆角外框；summary-bracket = 概要括号 */
  kind: "boundary" | "summary-bracket";
  direction?: "right" | "down";
}

/** 外框/概要括号：覆盖在成员包围盒上的非交互图层节点，位于主题节点之下。 */
export function MindmapFrameNode({ id, data, selected }: NodeProps) {
  const { t } = useI18n();
  const frame = data as MindmapFrameData;
  const color = frame.color && frame.color !== "auto" ? frame.color : "var(--mindmap-relation)";
  if (frame.kind === "summary-bracket") {
    const vertical = frame.direction === "down";
    return (
      <div
        className="mindmap-summary-bracket"
        role="img"
        data-direction={frame.direction}
        style={{ borderColor: color, pointerEvents: "none" }}
        aria-label={t("概要")}
        data-frame-id={id}
        data-selected={selected ? "true" : undefined}
      >
        {vertical ? (
          <Handle type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0 }} />
        ) : null}
      </div>
    );
  }
  return (
    <div
      className="mindmap-boundary"
      role="img"
      style={{ borderColor: color, pointerEvents: "none" }}
      aria-label={frame.label ? `${t("外框")} ${frame.label}` : t("外框")}
      data-frame-id={id}
      data-selected={selected ? "true" : undefined}
    >
      {frame.label ? (
        <span className="mindmap-boundary__label" style={{ color }}>
          {frame.label}
        </span>
      ) : null}
    </div>
  );
}
