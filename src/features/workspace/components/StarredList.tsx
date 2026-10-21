import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
      <EmptyState glyph="☆" title="还没有收藏" description="点击文档工具栏的 ☆ 即可收藏到这里">
        <Button variant="secondary" size="sm" onClick={() => onMockAction("收藏当前文档", "⌘D")}>
          ⌘D 收藏当前文档
        </Button>
      </EmptyState>
    );
  }

  return (
    <ul className="mx-auto flex w-full max-w-[760px] flex-col gap-1 p-8">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            onClick={() => onOpenNode(node)}
            className="flex w-full cursor-default items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="truncate text-[13.5px] font-medium">{node.title}</span>
            <span className="ml-3 shrink-0 text-[12px] text-muted-foreground">{node.updatedAt}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
