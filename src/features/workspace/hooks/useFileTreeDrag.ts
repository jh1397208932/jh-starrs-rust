import { type DragEvent, useState } from "react";
import { toErrorMessage } from "@/api/client";
import type { NodeItem } from "@/types/notebook";
import { resolveDropTarget, resolveRootDrop } from "../utils/tree";

/** 行内落点：节点前 / 节点后 / 文件夹内部 */
export type DropPosition = "before" | "after" | "inside";

/** 当前拖拽提示；targetId 为 null 表示根级末尾 */
export interface DropHint {
  targetId: string | null;
  position: DropPosition | "root";
}

export interface FileTreeDragOptions {
  /** 当前知识库平表 */
  nodes: NodeItem[];
  /** 提交移动；失败由 hook 交给 onError */
  onMove: (id: string, parentId: string | null, index: number) => Promise<void>;
  onError: (message: string) => void;
  /** 拖入文件夹后自动展开 */
  onExpand: (folderId: string) => void;
}

export interface FileTreeDragController {
  draggedId: string | null;
  dropHint: DropHint | null;
  handleDragStart: (event: DragEvent<HTMLButtonElement>, node: NodeItem) => void;
  handleDragEnd: () => void;
  handleRowDragOver: (event: DragEvent<HTMLButtonElement>, target: NodeItem) => void;
  handleRowDragLeave: (event: DragEvent<HTMLButtonElement>, target: NodeItem) => void;
  handleRowDrop: (event: DragEvent<HTMLButtonElement>, target: NodeItem) => void;
  handleRootDragOver: (event: DragEvent<HTMLFieldSetElement>) => void;
  handleRootDrop: (event: DragEvent<HTMLFieldSetElement>) => void;
}

/**
 * 文件树 HTML5 拖拽控制器：只负责“拖拽意图 → 落点 → 调后端”，不渲染。
 *
 * 拖到文件夹中部 = 子级；节点上/下缘 = 同级前后；列表底部 = 根级末尾。
 * 明显非法落点（拖入自身后代、非文件夹作为父级）在前端提前拒绝，后端仍是最终权威。
 */
export function useFileTreeDrag({
  nodes,
  onMove,
  onError,
  onExpand,
}: FileTreeDragOptions): FileTreeDragController {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);

  const clear = () => {
    setDraggedId(null);
    setDropHint(null);
  };

  const runMove = async (id: string, parentId: string | null, index: number) => {
    try {
      await onMove(id, parentId, index);
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, node: NodeItem) => {
    setDraggedId(node.id);
    setDropHint(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
  };

  const handleRowDragOver = (event: DragEvent<HTMLButtonElement>, target: NodeItem) => {
    if (!draggedId || draggedId === target.id) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const position: DropPosition =
      target.kind === "folder"
        ? ratio < 0.28
          ? "before"
          : ratio > 0.72
            ? "after"
            : "inside"
        : ratio < 0.5
          ? "before"
          : "after";
    const resolved = resolveDropTarget(nodes, draggedId, target.id, position);
    if (!resolved) {
      event.dataTransfer.dropEffect = "none";
      setDropHint(null);
      return;
    }
    event.dataTransfer.dropEffect = "move";
    setDropHint({ targetId: target.id, position });
  };

  const handleRowDragLeave = (event: DragEvent<HTMLButtonElement>, target: NodeItem) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDropHint((prev) => (prev?.targetId === target.id ? null : prev));
  };

  const handleRowDrop = (event: DragEvent<HTMLButtonElement>, target: NodeItem) => {
    event.preventDefault();
    event.stopPropagation();
    const movingId = draggedId;
    const hint = dropHint;
    if (!movingId || !hint || hint.targetId !== target.id || hint.position === "root") {
      clear();
      return;
    }
    if (hint.position === "inside") onExpand(target.id);
    const resolved = resolveDropTarget(nodes, movingId, target.id, hint.position);
    clear();
    if (!resolved) {
      onError("不能放到这里");
      return;
    }
    void runMove(movingId, resolved.parentId, resolved.index);
  };

  const handleRootDragOver = (event: DragEvent<HTMLFieldSetElement>) => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropHint({ targetId: null, position: "root" });
  };

  const handleRootDrop = (event: DragEvent<HTMLFieldSetElement>) => {
    event.preventDefault();
    const movingId = draggedId;
    if (!movingId) return;
    const target = resolveRootDrop(nodes, movingId);
    clear();
    void runMove(movingId, target.parentId, target.index);
  };

  return {
    draggedId,
    dropHint,
    handleDragStart,
    handleDragEnd: clear,
    handleRowDragOver,
    handleRowDragLeave,
    handleRowDrop,
    handleRootDragOver,
    handleRootDrop,
  };
}
