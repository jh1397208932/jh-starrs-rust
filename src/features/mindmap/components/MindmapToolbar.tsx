import {
  FoldVertical,
  ListPlus,
  Plus,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
  UnfoldVertical,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface MindmapToolbarProps {
  selectedId: string | null;
  rootId: string;
  collapsed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 同侧可成组的选中数量 */
  groupSize: number;
  onAddChild: () => void;
  onAddSibling: () => void;
  onToggle: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onAddBoundary: () => void;
  onAddSummary: () => void;
  onAddRelation: () => void;
  onAddFreeTopic: () => void;
  /** 按需打开右侧详情浮层，避免点选就遮住画布 */
  onOpenInspector: () => void;
}

/** 左下浮动工具栏：主题增删、撤销重做、外框/概要/关系线/自由主题。 */
export function MindmapToolbar({
  selectedId,
  rootId,
  collapsed,
  canUndo,
  canRedo,
  groupSize,
  onAddChild,
  onAddSibling,
  onToggle,
  onUndo,
  onRedo,
  onDelete,
  onAddBoundary,
  onAddSummary,
  onAddRelation,
  onAddFreeTopic,
  onOpenInspector,
}: MindmapToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="mindmap-floating-toolbar" role="toolbar" aria-label={t("导图编辑工具")}>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onAddChild}
        disabled={!selectedId}
        aria-label={t("新建子主题")}
        title={t("子主题 Tab")}
      >
        <ListPlus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onAddSibling}
        disabled={!selectedId}
        aria-label={t("新建同级主题")}
        title={t("同级主题 Enter")}
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onToggle}
        disabled={!selectedId || selectedId === rootId}
        aria-label={t("折叠或展开")}
      >
        {collapsed ? (
          <UnfoldVertical className="size-3.5" aria-hidden="true" />
        ) : (
          <FoldVertical className="size-3.5" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label={t("撤销")}
      >
        <Undo2 className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label={t("重做")}
      >
        <Redo2 className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onDelete}
        disabled={!selectedId || selectedId === rootId}
        aria-label={t("删除主题")}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
      </button>
      <span className="mindmap-toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="mindmap-toolbar-button"
        disabled={groupSize < 2}
        onClick={onAddBoundary}
        aria-label={t("添加外框")}
        title={t("为选中的同级主题添加外框")}
      >
        <span className="mindmap-glyph">▭</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        disabled={groupSize < 2}
        onClick={onAddSummary}
        aria-label={t("添加概要")}
        title={t("为选中的同级主题添加概要")}
      >
        <span className="mindmap-glyph">⌵</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        disabled={!selectedId}
        onClick={onAddRelation}
        aria-label={t("添加关系线")}
        title={t("从中心主题连一条关系到选中主题")}
      >
        <span className="mindmap-glyph">⤳</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onAddFreeTopic}
        aria-label={t("新建自由主题")}
        title={t("在画布空白处新建自由主题")}
      >
        <span className="mindmap-glyph">◇</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar-button"
        onClick={onOpenInspector}
        disabled={!selectedId}
        aria-label={t("主题详情")}
        title={t("主题详情")}
      >
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
