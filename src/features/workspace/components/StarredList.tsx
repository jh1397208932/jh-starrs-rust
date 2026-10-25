import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import type { NodeItem } from "@/types/notebook";

export interface StarredListProps {
  /** 收藏节点（已展平过滤） */
  nodes: NodeItem[];
  onOpenNode: (node: NodeItem) => void;
  /** mock 动作统一提示（label 动作名，kbd 可选快捷键徽标） */
  onMockAction: (label: string, kbd?: string) => void;
}

/**
 * 收藏列表虚拟页（WindowBar 标签 kind="starred"）：
 * 空态引导「⌘D 收藏当前文档」；否则渲染节点卡片列表，点击打开节点。
 */
export function StarredList({ nodes, onOpenNode, onMockAction }: StarredListProps) {
  if (nodes.length === 0) {
    return (
      <EmptyState glyph="☆" title="还没有收藏" description="收藏的文档会显示在这里">
        <Button variant="secondary" size="sm" onClick={() => onMockAction("收藏当前文档", "⌘D")}>
          ⌘D 收藏当前文档
        </Button>
      </EmptyState>
    );
  }

  return (
    <ul className="mx-auto flex w-full max-w-[780px] flex-col gap-0.5 px-8 py-10">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => onOpenNode(node)}
            className="flex w-full cursor-default items-center justify-between rounded-[12px] border border-transparent px-4 py-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:border-border/60 hover:bg-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate text-[13.5px] font-medium">{node.title}</span>
            <span className="ml-3 shrink-0 text-[12px] text-muted-foreground">
              {formatTimestamp(node.updatedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
