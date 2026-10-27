import { ChevronRight, ListTree, Plus, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";

export interface MindmapOutlineProps {
  root: MindmapTopic;
  selectedId: string | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
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
  branchIndex: number;
}

/** 大纲视图：左侧浮动卡片，树形列表直接编辑文本，与画布共享同一棵树。 */
export function MindmapOutline({
  root,
  selectedId,
  editingId,
  setEditingId,
  onSelect,
  onNavigate,
  onUpdateText,
  onAddChild,
  onDelete,
  onClose,
}: MindmapOutlineProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 新建子主题后直接聚焦行内输入（autoFocus 被 lint 禁止，改为渲染后聚焦）。
  useEffect(() => {
    if (!editingId) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingId]);

  const rows = useMemo(() => {
    const list: OutlineRow[] = [];
    const walk = (topic: MindmapTopic, depth: number, branchIndex: number) => {
      list.push({ topic, depth, branchIndex });
      if (collapsed.has(topic.id)) return;
      (topic.children ?? []).forEach((child, index) => {
        walk(child, depth + 1, depth === 0 ? index : branchIndex);
      });
    };
    walk(root, 0, 0);
    return list;
  }, [collapsed, root]);

  return (
    <aside className="mindmap-outline" aria-label={t("大纲视图")}>
      <header className="mindmap-outline__header">
        <ListTree className="size-3.5 text-[var(--logo-c)]" aria-hidden="true" />
        <span className="flex-1 truncate text-[12.5px] font-semibold">{t("大纲视图")}</span>
        <span className="mindmap-outline__count">{rows.length}</span>
        <button type="button" className="mindmap-toolbar-button" onClick={onClose} aria-label={t("关闭大纲")}>
          ✕
        </button>
      </header>
      <div className="mindmap-outline__list" role="tree">
        {rows.map(({ topic, depth, branchIndex }) => {
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
              style={
                {
                  paddingLeft: 6 + depth * 14,
                  "--outline-branch": `var(--mindmap-branch-${branchIndex % 6})`,
                } as CSSProperties
              }
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
              {depth > 0 ? (
                <span className="mindmap-outline__branch" aria-hidden="true" />
              ) : (
                <span className="mindmap-outline__branch is-root" aria-hidden="true" />
              )}
              {editingId === topic.id ? (
                <input
                  ref={inputRef}
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
                    // 折叠状态下新建的子主题默认不可见；先展开父行再新增。
                    setCollapsed((current) => {
                      if (!current.has(topic.id)) return current;
                      const next = new Set(current);
                      next.delete(topic.id);
                      return next;
                    });
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
