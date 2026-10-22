import { GripVertical, Plus } from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { blockTypeLabel } from "../blockLabels";

export interface BlockHandleProps {
  /** 当前手柄指向的块位置；-1/undefined 表示无目标 */
  targetPos?: number;
  /** 当前手柄指向的块类型（用于提示与自动化断言） */
  targetType?: string;
  /** 相对 .doc-editor-body 的纵坐标 */
  top: number;
  /** 相对 .doc-editor-body 的横坐标 */
  left: number;
  /** 显隐由鼠标位置计算；隐藏时保留 DOM 以维持指针捕获 */
  visible: boolean;
  /** 在当前块之后插入新段落 */
  onAddBelow: () => void;
  /** 按下六点手柄，开始指针拖拽 */
  onGripPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/**
 * 块级手柄：左侧“+”插入与六点拖动手柄。
 *
 * 位置与显隐由 useBlockHandle 计算；拖拽由 pointer 逻辑接管，
 * 不依赖 WebView 的 HTML5 拖放实现。
 */
export function BlockHandle({
  targetPos,
  targetType,
  top,
  left,
  visible,
  onAddBelow,
  onGripPointerDown,
}: BlockHandleProps) {
  const typeLabel = blockTypeLabel(targetType);
  const targetLabel = `拖动${typeLabel}`;
  const style: CSSProperties = { top, left };
  return (
    <div
      className="editor-block-handle"
      style={style}
      data-visible={visible}
      data-target-pos={targetPos}
      data-target-type={targetType}
    >
      <button
        type="button"
        className="editor-block-handle__button"
        aria-label="在下方插入块"
        title="在下方插入块"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onAddBelow}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="editor-block-handle__grip"
        aria-label={targetLabel}
        title={`${targetLabel}（拖动排序）`}
        tabIndex={-1}
        data-block-drag-grip=""
        onPointerDown={onGripPointerDown}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
