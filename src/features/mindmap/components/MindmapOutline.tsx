import { ChevronRight, ListTree, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";

export interface MindmapOutlineProps {
  root: MindmapTopic;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNavigate: (id: string) => void;
  onUpdateText: (id: string, text: string) => void;
  onAddChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface OutlineRow {
  topic: MindmapTopic;
  depth: number;
}

/** 大纲视图：右侧抽屉，树形列表直接编辑文本，与画布共享同一棵树。 */
export function MindmapOutline({
  root,
  selectedId,
  onSelect,
  onNavigate,
  onUpdateText,
  onAddChild,
  onDelete,
  onClose,
}: MindmapOutlineProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list: OutlineRow[] = [];
    const walk = (topic: MindmapTopic, depth: number) => {
      list.push({ topic, depth });
      if (collapsed.has(topic.id)) return;
      for (const child of topic.children ?? []) walk(child, depth + 1);
    };
    walk(root, 0);
    return list;
  }, [collapsed, root]);

  return (
    <aside className="mindmap-outline" aria-label={t("大纲视图")}>
      <header className="mindmap-outline__header">
        <ListTree className="size-3.5" aria-hidden="true" />
        <span className="flex-1 truncate text-[12.5px] font-semibold">{t("大纲视图")}</span>
        <button type="button" className="mindmap-toolbar-button" onClick={onClose} aria-label={t("关闭大纲")}>
          ✕
        </button>
      </header>
      <div className="mindmap-outline__list" role="tree">
        {rows.map(({ topic, depth }) => {
          const hasChildren = (topic.children?.length ?? 0) > 0;
          const isCollapsed = collapsed.has(topic.id);
          return (
            <div
              key={topic.id}
              role="treeitem"
              tabIndex={0}
              aria-level={depth + 1}
              aria-selected={selectedId === topic.id}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              className={
                selectedId === topic.id ? "mindmap-outline__row is-selected" : "mindmap-outline__row"
              }
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onSelect(topic.id)}
              onDoubleClick={() => onNavigate(topic.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(topic.id);
                }
              }}
            >
              <button
                type="button"
                className="mindmap-outline__toggle"
                aria-label={isCollapsed ? t("展开") : t("折叠")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!hasChildren) return;
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(topic.id)) next.delete(topic.id);
                    else next.add(topic.id);
                    return next;
                  });
                }}
              >
                {hasChildren ? (
                  <ChevronRight
                    className="size-3"
                    style={{ transform: isCollapsed ? "none" : "rotate(90deg)" }}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="mindmap-outline__dot" aria-hidden="true" />
                )}
              </button>
              {editingId === topic.id ? (
                <input
                  // 大纲与画布共用 updateTopic，逐字合并撤销历史
                  className="mindmap-outline__input"
                  defaultValue={topic.text}
                  onBlur={(event) => {
                    setEditingId(null);
                    if (event.target.value !== topic.text) onUpdateText(topic.id, event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      event.currentTarget.value = topic.text;
                      event.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="mindmap-outline__text"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setEditingId(topic.id);
                  }}
                >
                  {topic.text || t("无标题主题")}
                </button>
              )}
              <span className="mindmap-outline__actions">
                <button
                  type="button"
                  className="mindmap-toolbar-button"
                  aria-label={t("新建子主题")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAddChild(topic.id);
                  }}
                >
                  <Plus className="size-3" aria-hidden="true" />
                </button>
                {depth > 0 ? (
                  <button
                    type="button"
                    className="mindmap-toolbar-button"
                    aria-label={t("删除主题")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(topic.id);
                    }}
                  >
                    <Trash2 className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
