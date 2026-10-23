import { Plus } from "lucide-react";
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
  /** 文档保存成功后同步树节点元信息 */
  onDocumentSaved?: (nodeId: string, info: { wordCount: number; updatedAt: number }) => void;
  /** 编辑器错误提示 */
  onError?: (message: string) => void;
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
  onDocumentSaved,
  onError,
}: TabContentViewProps) {
  if (!activeTab) {
    return (
      <EmptyState
        variant="hero"
        glyph="✦"
        eyebrow="Starris · Local Workspace"
        title="从一个想法开始"
        description="输入 / 唤起命令，或把 Markdown 文件拖进这片纸面。所有内容只保存在本地。"
      >
        <button type="button" onClick={() => onCreateDoc("未命名文档")} className="empty-cta">
          <Plus className="size-4" />
          新建文档
          <span className="empty-cta__kbd">⌘N</span>
        </button>
      </EmptyState>
    );
  }
  if (activeTab.kind === "board") return <BoardView />;
  if (activeTab.kind === "starred") {
    return <StarredList nodes={starredNodes} onOpenNode={onOpenNode} onMockAction={onMockAction} />;
  }
  if (activeTab.kind === "table") {
    return <EmptyState glyph="⊞" title="表格视图" description="表格编辑器将在后续阶段实现" />;
  }
  if (activeTab.kind === "flow") {
    return <EmptyState glyph="⌘" title="流程图视图" description="流程图编辑器将在后续阶段实现" />;
  }

  return (
    <DocEditor
      node={activeNode}
      title={activeTab.title}
      onDocumentSaved={onDocumentSaved}
      onError={onError}
    />
  );
}
