import { Plus } from "lucide-react";
import { ShimmerButton } from "@/components/common/motion/ShimmerButton";
import { EmptyState } from "@/components/ui/empty-state";
import { BoardView } from "@/features/board/components/BoardView";
import { DocEditor } from "@/features/editor/components/DocEditor";
import type { NodeItem, TabItem } from "@/types/notebook";
import { StarredList } from "./StarredList";

export interface TabContentViewProps {
  /** 当前激活标签页（null = 无标签，走空状态） */
  activeTab: TabItem | null;
  /** 激活标签关联的树节点（虚拟页/未命名暂存为 null） */
  activeNode: NodeItem | null;
  /** 收藏节点列表（收藏虚拟页使用） */
  starredNodes: NodeItem[];
  onOpenNode: (node: NodeItem) => void;
  onCreateDoc: (title: string) => void;
  /** mock 未实现动作统一提示 */
  onMockAction: (label: string, kbd?: string) => void;
}

/**
 * 标签内容路由：按激活标签类型选择视图——
 * 无标签 → 空状态引导；board → 画板；starred → 收藏列表；table → 占位空状态；doc → 编辑器。
 */
export function TabContentView({
  activeTab,
  activeNode,
  starredNodes,
  onOpenNode,
  onCreateDoc,
  onMockAction,
}: TabContentViewProps) {
  if (!activeTab) {
    return (
      <EmptyState glyph="✦" title="从一个想法开始" description="输入 / 唤起命令，或拖入 Markdown 文件">
        <ShimmerButton
          type="button"
          className="px-4 py-2 text-[13px]"
          shimmerDuration="2.6s"
          onClick={() => onCreateDoc("未命名文档")}
        >
          <Plus className="size-3.5" />
          新建文档
        </ShimmerButton>
      </EmptyState>
    );
  }
  if (activeTab.kind === "board") return <BoardView />;
  if (activeTab.kind === "starred") {
    return <StarredList nodes={starredNodes} onOpenNode={onOpenNode} onMockAction={onMockAction} />;
  }
  if (activeTab.kind === "table") {
    return <EmptyState glyph="⊞" title="表格视图" description="表格编辑器将在后续阶段实现（mock 占位）" />;
  }
  return <DocEditor node={activeNode} title={activeTab.title} onMockAction={onMockAction} />;
}
