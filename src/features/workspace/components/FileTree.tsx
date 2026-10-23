import { Plus } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NodeItem, TreeNode } from "@/types/notebook";
import { useFileTreeDrag } from "../hooks/useFileTreeDrag";
import { FileTreeRow } from "./FileTreeRow";

export interface FileTreeProps {
  /** 当前知识库递归树 */
  tree: TreeNode[];
  /** 当前知识库平表（拖拽索引计算用） */
  nodes: NodeItem[];
  /** 当前知识库名称；null = 工作区还没有知识库 */
  currentKbName: string | null;
  /** 当前激活标签对应节点 */
  selectedNodeId: string | null;
  onOpenNode: (node: NodeItem) => void;
  onCreateRoot: () => void;
  onCreateChild: (parent: NodeItem) => void;
  onRename: (node: NodeItem) => void;
  onDelete: (node: NodeItem) => void;
  /** 拖动移动；失败由拖拽 hook 调 onError */
  onMove: (id: string, parentId: string | null, index: number) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * 左侧文件树：任意层级、文件夹展开/折叠、节点 CRUD 菜单与 HTML5 拖拽。
 * 行渲染在 FileTreeRow；拖拽规则在 useFileTreeDrag；本组件负责状态、键盘导航与空态。
 */
export function FileTree({
  tree,
  nodes,
  currentKbName,
  selectedNodeId,
  onOpenNode,
  onCreateRoot,
  onCreateChild,
  onRename,
  onDelete,
  onMove,
  onError,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const expandFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const drag = useFileTreeDrag({ nodes, onMove, onError, onExpand: expandFolder });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0 && event.key !== "ArrowDown") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index < 0 ? 0 : index - 1);
      rows[next]?.focus();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const folderId = rows[index]?.dataset.folderId;
      if (!folderId) return;
      event.preventDefault();
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (event.key === "ArrowRight") next.delete(folderId);
        else next.add(folderId);
        return next;
      });
    }
  };

  return (
    <div className="mx-2 mt-2 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[10.5px] font-semibold tracking-[0.14em] text-sidebar-muted uppercase">
          <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-primary/70" />
          {currentKbName ?? "文件"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="新建节点"
              disabled={!currentKbName}
              onClick={onCreateRoot}
              className="grid size-6 cursor-default place-items-center rounded-[8px] text-sidebar-muted transition-colors duration-150 ease-[var(--ease)] hover:bg-card/50 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{currentKbName ? "新建节点" : "请先新建知识库"}</TooltipContent>
        </Tooltip>
      </div>

      <div
        role="tree"
        aria-label="文件树"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
      >
        {!currentKbName ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-sidebar-muted">
            当前工作区还没有知识库
            <br />
            使用左上角菜单新建知识库
          </p>
        ) : tree.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-sidebar-muted">
            还没有内容
            <br />
            点击右上角 + 新建
          </p>
        ) : (
          tree.map((entry) => (
            <FileTreeRow
              key={entry.node.id}
              entry={entry}
              depth={0}
              collapsed={collapsed}
              selectedNodeId={selectedNodeId}
              drag={drag}
              onToggleFolder={toggleFolder}
              onOpenNode={onOpenNode}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
        <fieldset
          aria-label="拖到根级末尾"
          onDragOver={drag.handleRootDragOver}
          onDrop={drag.handleRootDrop}
          className={cn(
            "mt-auto min-h-8 shrink-0 rounded-[10px]",
            drag.draggedId && "border border-dashed border-primary/40",
            drag.dropHint?.position === "root" && "bg-accent",
          )}
        />
      </div>
    </div>
  );
}
