import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { searchNodes } from "@/api/search";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NODE_KIND_BY_TYPE, NODE_KIND_LABELS } from "@/types/notebook";
import type { SearchHit } from "@/types/search";

export type SearchMode = "search" | "quick";

export interface SearchPaletteProps {
  /** 是否打开 */
  open: boolean;
  /** 搜索或快速跳转 */
  mode: SearchMode;
  /** 当前知识库；为空时不请求 */
  knowledgeBaseId: string | null;
  onOpenChange: (open: boolean) => void;
  /** 选中结果后打开节点 */
  onSelect: (nodeId: string) => void;
}

/**
 * 搜索 / 快速跳转面板：空查询显示最近节点，输入后查询当前知识库。
 */
export function SearchPalette({ open, mode, knowledgeBaseId, onOpenChange, onSelect }: SearchPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (nextQuery: string) => {
      if (!knowledgeBaseId) return;
      const request = ++requestRef.current;
      setLoading(true);
      setError(null);
      try {
        const results = await searchNodes({
          query: nextQuery,
          knowledgeBaseId,
          limit: 20,
        });
        if (requestRef.current !== request) return;
        setHits(results);
        setActiveIndex(0);
      } catch (caught) {
        if (requestRef.current !== request) return;
        setHits([]);
        setError(toErrorMessage(caught));
      } finally {
        if (requestRef.current === request) setLoading(false);
      }
    },
    [knowledgeBaseId],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setError(null);
    setActiveIndex(0);
    void load("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void load(query.trim());
    }, 160);
    return () => clearTimeout(timer);
  }, [open, query, load]);

  const choose = (hit: SearchHit | undefined) => {
    if (!hit) return;
    onSelect(hit.nodeId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* dialog-top：只做水平居中；基类的 -50% Y 平移会把 12% top 再抬半个面板高度。
          showClose=false：行内已有 Esc 徽标，右上角 × 会与之重叠。 */}
      <DialogContent
        className="dialog-top top-[12%] w-[560px] gap-0 p-0"
        aria-describedby={undefined}
        showClose={false}
      >
        <DialogTitle className="sr-only">{mode === "quick" ? t("快速跳转") : t("搜索")}</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, hits.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(hits[activeIndex]);
              }
            }}
            aria-label={mode === "quick" ? t("快速跳转") : t("搜索")}
            placeholder={mode === "quick" ? t("跳转到最近内容…") : t("搜索标题与正文…")}
            className="h-7 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">Esc</span>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-1.5" role="listbox" aria-label={t("搜索结果")}>
          {loading && hits.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("正在搜索…")}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="mx-2 my-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
            >
              {error}
            </div>
          ) : hits.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-muted-foreground">
              {query.trim() ? t("没有找到匹配内容") : t("还没有最近内容")}
            </div>
          ) : (
            hits.map((hit, index) => {
              const kind = NODE_KIND_BY_TYPE[hit.nodeType];
              return (
                <button
                  key={hit.nodeId}
                  type="button"
                  role="option"
                  aria-label={t("打开 {title}", { title: hit.title })}
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(hit)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease)]",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                  )}
                >
                  <NodeKindIcon kind={kind} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{hit.title}</span>
                      <span className="shrink-0 text-[10.5px] text-muted-foreground">
                        {t(NODE_KIND_LABELS[kind])}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                      {hit.snippet || hit.kbName}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
