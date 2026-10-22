import { ChevronDown, ChevronRight, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NodeItem, TreeNode } from "@/types/notebook";
import type { FileTreeDragController } from "../hooks/useFileTreeDrag";

export interface FileTreeRowProps {
  entry: TreeNode;
  depth: number;
  collapsed: Set<string>;
  selectedNodeId: string | null;
  drag: FileTreeDragController;
  onToggleFolder: (id: string) => void;
  onOpenNode: (node: NodeItem) => void;
  onCreateChild: (parent: NodeItem) => void;
  onRename: (node: NodeItem) => void;
  onDelete: (node: NodeItem) => void;
}

/** 单个树行（递归）：展开/折叠、选中、拖放提示与节点操作菜单。 */
export function FileTreeRow(props: FileTreeRowProps) {
  const { entry, depth, collapsed, selectedNodeId, drag } = props;
  const { node, children } = entry;
  const isFolder = node.kind === "folder";
  const isCollapsed = collapsed.has(node.id);
  const selected = selectedNodeId === node.id;
  const hint = drag.dropHint?.targetId === node.id ? drag.dropHint.position : null;
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;

  return (
    <div>
      <div
        className={cn(
          "group relative flex h-8 items-center rounded-sm",
          selected ? "bg-sidebar-active text-sidebar-active-fg" : "hover:bg-secondary",
          drag.draggedId === node.id && "opacity-50",
          hint === "inside" && "bg-accent text-accent-foreground ring-1 ring-primary ring-inset",
        )}
      >
        {hint === "before" && (
          <span className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary" />
        )}
        {hint === "after" && (
          <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />
        )}
        <button
          type="button"
          draggable
          onDragStart={(event) => drag.handleDragStart(event, node)}
          onDragEnd={drag.handleDragEnd}
          onDragOver={(event) => drag.handleRowDragOver(event, node)}
          onDragLeave={(event) => drag.handleRowDragLeave(event, node)}
          onDrop={(event) => drag.handleRowDrop(event, node)}
          data-tree-row
          data-folder-id={isFolder ? node.id : undefined}
          role="treeitem"
          aria-selected={selected}
          aria-expanded={isFolder ? !isCollapsed : undefined}
          aria-level={depth + 1}
          onClick={() => {
            if (isFolder) props.onToggleFolder(node.id);
            else props.onOpenNode(node);
          }}
          className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 self-stretch rounded-sm pr-1 text-left text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {isFolder ? (
            <Chevron className="size-3.5 shrink-0 text-sidebar-muted" />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <NodeKindIcon kind={node.kind} className="size-4 shrink-0" />
          <span className={cn("truncate", selected && "font-semibold")}>{node.title}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${node.title} 操作`}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              className="mr-1 grid size-6 shrink-0 cursor-default place-items-center rounded-sm text-sidebar-muted opacity-0 transition-opacity duration-150 ease-[var(--ease)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[140px]">
            {isFolder ? (
              <DropdownMenuItem onSelect={() => props.onCreateChild(node)}>
                <Plus />
                新建子级
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => props.onOpenNode(node)}>
                <NodeKindIcon kind={node.kind} />
                打开
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => props.onRename(node)}>
              <Pencil />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => props.onDelete(node)}>
              <Trash2 />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isFolder &&
        !isCollapsed &&
        children.map((child) => (
          <FileTreeRow key={child.node.id} {...props} entry={child} depth={depth + 1} />
        ))}
    </div>
  );
}
