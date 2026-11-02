import { Layers, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { type BoardLibraryEntry, prefetchLibraryPreviews } from "../hooks/useBoardLibrary";
import { LIBRARY_CATEGORIES, type LibraryCategoryId } from "../libraryCatalog";
import { BoardLibraryCard } from "./BoardLibraryCard";

export interface BoardLibraryPanelProps {
  entries: BoardLibraryEntry[];
  loading: boolean;
  insertingKey: string | null;
  onInsert: (entry: BoardLibraryEntry) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, entry: BoardLibraryEntry) => void;
  onClose: () => void;
}

/**
 * 画板右侧组件库：分类标签 + 缩略图网格。
 * 点击插入到画布中央，拖到画布按落点插入。
 */
export function BoardLibraryPanel({
  entries,
  loading,
  insertingKey,
  onInsert,
  onPointerDown,
  onClose,
}: BoardLibraryPanelProps) {
  const { t } = useI18n();
  const [active, setActive] = useState<LibraryCategoryId>("basic");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) {
      return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
    }
    return entries.filter((entry) => entry.category === active);
  }, [active, entries, query]);

  const groups = useMemo(() => {
    const map = new Map<string, BoardLibraryEntry[]>();
    for (const entry of visible) {
      const list = map.get(entry.section);
      if (list) list.push(entry);
      else map.set(entry.section, [entry]);
    }
    return [...map.entries()];
  }, [visible]);

  const activeCategory = LIBRARY_CATEGORIES.find((category) => category.id === active);
  const emptyMine = active === "mine" && entries.every((entry) => entry.category !== "mine");

  // 面板一打开就预热缩略图：当前分类优先，其余随后；生成按帧预算走，不挡首次绘制。
  // 这样滚动时不再是"空图标 → 等一会才出图"，而是直接命中已生成的结果。
  useEffect(() => {
    if (loading) return;
    const frame = window.requestAnimationFrame(() => {
      prefetchLibraryPreviews([
        ...entries.filter((entry) => entry.category === active),
        ...entries.filter((entry) => entry.category !== active),
      ]);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, entries, loading]);

  return (
    <aside className="board-library-panel" aria-label={t("组件")}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-xs)] bg-secondary text-muted-foreground">
          <Layers className="size-3.5" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-foreground">
          {t("组件")}
        </h2>
        <button
          type="button"
          aria-label={t("收起组件库")}
          onClick={onClose}
          className="grid size-6 shrink-0 place-items-center rounded-[var(--radius-xs)] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground active:scale-[0.94]"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div role="tablist" aria-label={t("组件分类")} className="board-library-tabs">
        {LIBRARY_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            role="tab"
            aria-selected={active === category.id}
            data-active={active === category.id}
            title={t(category.hint)}
            onClick={() => {
              setQuery("");
              setActive(category.id);
            }}
            className="board-library-tab"
          >
            {t(category.label)}
          </button>
        ))}
      </div>

      <div className="relative shrink-0 px-3 pb-2">
        <Search className="pointer-events-none absolute top-1/2 left-[22px] size-3 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("搜索组件")}
          placeholder={t("搜索组件…")}
          className="h-[30px] w-full rounded-[var(--radius-sm)] border border-border/70 bg-background pr-2 pl-7 text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="board-library-list px-3 pb-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2 pt-1" role="status" aria-label={t("正在加载组件…")}>
            {["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((key) => (
              <div key={key} className="board-library-skeleton" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="board-library-state">
            <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] bg-secondary text-muted-foreground/70">
              <Layers className="size-4" />
            </span>
            <p className="text-[12px] font-medium text-foreground">
              {query.trim() ? t("没有找到匹配组件") : t("这里还没有组件")}
            </p>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
              {emptyMine
                ? t("在「更多 → 组件库」启用或导入后，会出现在这里。")
                : query.trim()
                  ? t("换个关键词试试。")
                  : t(activeCategory?.hint ?? "")}
            </p>
          </div>
        ) : (
          groups.map(([section, items]) => (
            <section key={section} className="mt-3 first:mt-1" aria-label={section}>
              <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
                <span className="size-1 rounded-full bg-primary" aria-hidden="true" />
                <h3 className="text-[10.5px] font-semibold tracking-[0.06em] text-muted-foreground">
                  {section}
                </h3>
                <span className="font-mono text-[9.5px] text-muted-foreground/70 tabular-nums">
                  {items.length}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {items.map((entry) => (
                  <BoardLibraryCard
                    key={entry.key}
                    entry={entry}
                    inserting={insertingKey === entry.key}
                    onInsert={onInsert}
                    onPointerDown={onPointerDown}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <footer className="shrink-0 border-t border-border/40 px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
        {t("点击插入到画布中央，也可拖到任意位置")}
      </footer>
    </aside>
  );
}
