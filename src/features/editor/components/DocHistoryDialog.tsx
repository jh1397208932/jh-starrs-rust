import { History, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { type DocHistorySummary, listDocumentHistory, restoreDocumentHistory } from "@/api/history";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";

export interface DocHistoryDialogProps {
  open: boolean;
  nodeId: string;
  onOpenChange: (open: boolean) => void;
  /** 恢复成功后由编辑器丢弃本地修改并重新加载 */
  onRestored: () => void;
}

/** 文档历史：列出自动快照（10 分钟间隔），恢复后重新加载正文。 */
export function DocHistoryDialog({ open, nodeId, onOpenChange, onRestored }: DocHistoryDialogProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<DocHistorySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    void listDocumentHistory(nodeId)
      .then(setItems)
      .catch((caught) => setError(toErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [open, nodeId]);

  const restore = (item: DocHistorySummary) => {
    if (busy) return;
    setBusy(item.id);
    setError(null);
    void (async () => {
      try {
        await restoreDocumentHistory(nodeId, item.id);
        onRestored();
        onOpenChange(false);
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[460px] p-5" aria-describedby={undefined}>
        <DialogTitle>{t("历史版本")}</DialogTitle>
        <div className="mt-3 max-h-[360px] overflow-y-auto rounded-md border border-border/70">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t("正在读取历史…")}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-muted-foreground">
              <History className="mx-auto mb-2 size-5 opacity-60" />
              {t("暂无历史版本")}
            </div>
          ) : (
            <ul aria-label={t("历史版本列表")}>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0"
                >
                  <span className="text-[12.5px]">{formatTimestamp(item.createdAt)}</span>
                  <span className="ml-auto text-[11.5px] text-muted-foreground">
                    {item.wordCount} {t("字")}
                  </span>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => restore(item)}>
                    {busy === item.id ? t("恢复中…") : t("恢复")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => onOpenChange(false)}>
            {t("关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
