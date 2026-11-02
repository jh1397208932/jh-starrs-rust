import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { emptyNodeTrash, listNodeTrash, purgeNode, restoreNode, type TrashNodeItem } from "@/api/node";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";

export interface NodeTrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBaseId: string;
  /** 恢复/删除后刷新外部文件树 */
  onChanged: () => void;
}

/** 文件回收站：只列根节点，恢复时整棵子树一起回来。 */
export function NodeTrashDialog({ open, onOpenChange, knowledgeBaseId, onChanged }: NodeTrashDialogProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<TrashNodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const refresh = useCallback(async () => {
    if (!knowledgeBaseId) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await listNodeTrash(knowledgeBaseId));
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [knowledgeBaseId]);

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    setConfirmPurge(null);
    setConfirmEmpty(false);
    void refresh();
  }, [open, refresh]);

  const run = async (id: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      setConfirmPurge(null);
      setConfirmEmpty(false);
      await refresh();
      onChanged();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const restore = (item: TrashNodeItem) =>
    run(item.id, async () => {
      const result = await restoreNode(item.id);
      setNotice(
        result.restoredCount > 1
          ? t("已恢复「{title}」等 {count} 项", {
              title: item.title,
              count: result.restoredCount,
            })
          : t("已恢复「{title}」", { title: item.title }),
      );
    });

  const purge = (item: TrashNodeItem) => {
    if (confirmPurge !== item.id) {
      setConfirmPurge(item.id);
      setConfirmEmpty(false);
      return;
    }
    void run(item.id, async () => {
      await purgeNode(item.id);
      setNotice(t("已删除「{title}」", { title: item.title }));
    });
  };

  const empty = () => {
    if (!confirmEmpty) {
      setConfirmEmpty(true);
      setConfirmPurge(null);
      return;
    }
    void run("__empty__", async () => {
      const result = await emptyNodeTrash(knowledgeBaseId);
      setNotice(t("已清空回收站（{count} 项）", { count: result.deletedCount }));
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[540px] p-5" aria-describedby={undefined}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>{t("回收站")}</DialogTitle>
            <p className={cn(CAPTION_CLS, "mt-1 text-muted-foreground")}>{t("恢复后回到原来的位置")}</p>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-[12px] text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={cn(CAPTION_CLS, "mt-3 text-primary")}>
            {notice}
          </p>
        )}

        <div className="mt-3 max-h-[340px] overflow-y-auto rounded-md border border-border/70">
          {loading ? (
            <div className="grid h-24 place-items-center text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" /> {t("读取中…")}
              </span>
            </div>
          ) : items.length === 0 ? (
            <div className="grid h-24 place-items-center text-[12.5px] text-muted-foreground">
              {t("回收站为空")}
            </div>
          ) : (
            <ul aria-label={t("回收站列表")}>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 last:border-b-0"
                >
                  <NodeKindIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-foreground">{item.title}</p>
                    <p className={cn(CAPTION_CLS, "truncate text-muted-foreground")}>
                      {item.path} · {formatTimestamp(item.deletedAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    aria-label={t("恢复 {title}", { title: item.title })}
                    onClick={() => void restore(item)}
                  >
                    {t("恢复")}
                  </Button>
                  <Button
                    variant={confirmPurge === item.id ? "destructive" : "ghost"}
                    size="sm"
                    disabled={busy !== null}
                    aria-label={
                      confirmPurge === item.id
                        ? t("确认永久删除 {title}", { title: item.title })
                        : t("永久删除 {title}", { title: item.title })
                    }
                    onClick={() => purge(item)}
                  >
                    <Trash2 className="size-3.5" />
                    {confirmPurge === item.id ? t("确认删除？") : t("删除")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 页头右上是对话框自带的关闭按钮，清空动作放页脚避免叠在一起 */}
        <div className="mt-4 flex justify-end">
          <Button
            variant={confirmEmpty ? "destructive" : "outline"}
            size="sm"
            disabled={loading || busy !== null || items.length === 0}
            onClick={empty}
          >
            {confirmEmpty ? t("确认清空？") : t("清空回收站")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
