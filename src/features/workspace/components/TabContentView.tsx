import { Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { AttachmentNodeView } from "@/features/attachments/components/AttachmentNodeView";
import { BoardView } from "@/features/board/components/BoardView";
import { DocEditor } from "@/features/editor/components/DocEditor";
import { MindmapView } from "@/features/mindmap/components/MindmapView";
import { useI18n } from "@/lib/i18n";
import type { NodeItem, TabItem } from "@/types/notebook";
import { StarredList } from "./StarredList";

export interface TabContentViewProps {
  /** 当前激活标签页（null = 无标签，走空状态） */
  activeTab: TabItem | null;
  /** 激活标签关联的树节点（虚拟页/未命名暂存为 null） */
  activeNode: NodeItem | null;
  /** 收藏节点列表（收藏虚拟页使用） */
  starredNodes: NodeItem[];
  /** 当前文档所在知识库名（页头面包屑） */
  kbName: string | null;
  /** 当前节点是否已收藏 */
  starred: boolean;
  /** 信息浮窗是否展开 */
  infoOpen: boolean;
  /** 切换收藏状态 */
  onToggleStar: () => void;
  /** 打开 / 收起信息浮窗 */
  onToggleInfo: () => void;
  /** 打开分享与导出弹窗 */
  onShare: () => void;
  /** 触发打印 */
  onPrint: () => void;
  /** 点击面包屑中的知识库 */
  onOpenKb: () => void;
  onOpenNode: (node: NodeItem) => void;
  onCreateDoc: (title: string) => void;
  /** 文档保存成功后同步树节点元信息 */
  onDocumentSaved?: (nodeId: string, info: { wordCount: number; updatedAt: number }) => void;
  /** 画板保存成功后同步树节点编辑时间 */
  onBoardSaved?: (nodeId: string, updatedAt: number) => void;
  /** 画板导出成功提示 */
  onBoardExported?: (message: string) => void;
  /** 编辑器错误提示 */
  onError?: (message: string) => void;
}

/**
 * 标签内容路由：按激活标签类型选择视图——
 * 无标签 → 空状态引导；flow → 画板；starred → 收藏列表；table → 文档编辑器；doc → 编辑器。
 */
export function TabContentView({
  activeTab,
  activeNode,
  starredNodes,
  kbName,
  starred,
  infoOpen,
  onToggleStar,
  onToggleInfo,
  onShare,
  onPrint,
  onOpenKb,
  onOpenNode,
  onCreateDoc,
  onDocumentSaved,
  onBoardSaved,
  onBoardExported,
  onError,
}: TabContentViewProps) {
  const { t } = useI18n();
  if (!activeTab) {
    return (
      <EmptyState variant="hero" glyph="✦" title={t("开始记录")}>
        <button type="button" onClick={() => onCreateDoc(t("未命名文档"))} className="empty-cta">
          <Plus className="size-4" />
          {t("新建文档")}
          <span className="empty-cta__kbd">⌘N</span>
        </button>
      </EmptyState>
    );
  }
  if (activeTab.kind === "board" || activeTab.kind === "flow") {
    if (!activeNode) {
      return <EmptyState glyph="✦" title={t("画板未找到")} description={t("画板可能已被删除")} />;
    }
    return (
      <BoardView
        nodeId={activeNode.id}
        title={activeTab.title}
        kbName={kbName}
        onSaved={(updatedAt) => onBoardSaved?.(activeNode.id, updatedAt)}
        onError={onError ?? (() => undefined)}
        onOpenKb={onOpenKb}
        onExported={onBoardExported}
      />
    );
  }
  if (activeTab.kind === "mindmap") {
    if (!activeNode) {
      return <EmptyState glyph="✦" title={t("思维导图未找到")} description={t("思维导图可能已被删除")} />;
    }
    return (
      <MindmapView
        nodeId={activeNode.id}
        title={activeTab.title}
        kbName={kbName}
        onSaved={(updatedAt) => onBoardSaved?.(activeNode.id, updatedAt)}
        onError={onError ?? (() => undefined)}
        onOpenKb={onOpenKb}
        onExported={onBoardExported}
      />
    );
  }
  if (activeTab.kind === "attachment") {
    if (!activeNode) {
      return <EmptyState glyph="!" title={t("附件未找到")} description={t("附件可能已被删除")} />;
    }
    return (
      <AttachmentNodeView
        node={activeNode}
        kbName={kbName}
        onOpenKb={onOpenKb}
        onError={onError ?? (() => undefined)}
      />
    );
  }
  if (activeTab.kind === "starred") {
    return <StarredList nodes={starredNodes} onOpenNode={onOpenNode} />;
  }
  return (
    <DocEditor
      kind={activeTab.kind === "table" ? "table" : "doc"}
      node={activeNode}
      title={activeTab.title}
      kbName={kbName}
      starred={starred}
      infoOpen={infoOpen}
      onToggleStar={onToggleStar}
      onToggleInfo={onToggleInfo}
      onShare={onShare}
      onPrint={onPrint}
      onOpenKb={onOpenKb}
      onDocumentSaved={onDocumentSaved}
      onError={onError}
    />
  );
}
