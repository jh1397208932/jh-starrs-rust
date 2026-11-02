import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { NodeItem } from "@/types/notebook";
import type { PreviewKind } from "@/types/preview";

export interface DocEmbedPickerDialogProps {
  open: boolean;
  kind: PreviewKind;
  nodes: NodeItem[];
  onOpenChange: (open: boolean) => void;
  onSelect: (node: NodeItem) => void;
}

/** 从当前知识库选一个画板/思维导图插入文档。 */
export function DocEmbedPickerDialog({
  open,
  kind,
  nodes,
  onOpenChange,
  onSelect,
}: DocEmbedPickerDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const kindLabel = kind === "board" ? t("画板") : t("思维导图");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const targets = useMemo(() => nodes.filter((node) => node.kind === kind), [kind, nodes]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return targets;
    return targets.filter(
      (node) => node.title.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle),
    );
  }, [query, targets]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px] max-w-[92vw] p-5" aria-describedby={undefined}>
        <DialogHeader
          title={kind === "board" ? t("插入画板图") : t("插入思维导图")}
          description={t("插入的是预览图，源内容更新后会刷新。")}
        />
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索{name}…", { name: kindLabel })}
            aria-label={t("搜索{name}", { name: kindLabel })}
            className="pl-8"
          />
        </div>

        <div className="mt-3 max-h-[46vh] min-h-[180px] overflow-y-auto rounded-[10px] border border-border/60">
          {targets.length === 0 ? (
            <div className="flex h-[180px] flex-col items-center justify-center gap-2 px-6 text-center">
              <NodeKindIcon kind={kind} className="size-6 text-muted-foreground/60" />
              <p className="text-[12.5px] text-muted-foreground">
                {t("当前知识库还没有{name}，先在左侧新建一个。", { name: kindLabel })}
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-[180px] items-center justify-center text-[12.5px] text-muted-foreground">
              {t("没有找到匹配内容")}
            </div>
          ) : (
            <ul aria-label={t("{name}列表", { name: kindLabel })}>
              {filtered.map((node) => (
                <li key={node.id} className="border-b border-border/50 last:border-b-0">
                  <button
                    type="button"
                    aria-label={t("插入{name}", { name: node.title })}
                    onClick={() => onSelect(node)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-secondary text-muted-foreground">
                      <NodeKindIcon kind={node.kind} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {node.title}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">{node.path}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
