import { Bot } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import {
  type AiReviewPreview,
  approveAiInbox,
  getAiReviewPreview,
  listAiInbox,
  onAiReview,
  rejectAiInbox,
} from "@/api/ai";
import { toErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { useToast } from "@/hooks/useToast";
import { useI18n } from "@/lib/i18n";
import { EASE_STANDARD } from "@/lib/motion";
import { CAPTION_CLS, cn } from "@/lib/utils";

type ShowToast = ReturnType<typeof useToast>["showToast"];

const RISK_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高" };

/** 打开工作区时最多重建几条对比，历史积压太多时交给设置页处理。 */
const HYDRATION_MAX = 10;

/** 按 inboxId 去重合并待审队列，已有顺序不变。 */
function mergeQueue(existing: AiReviewPreview[], incoming: AiReviewPreview[]): AiReviewPreview[] {
  const known = new Set(existing.map((item) => item.inboxId));
  const appended = incoming.filter((item) => !known.has(item.inboxId));
  return appended.length === 0 ? existing : [...existing, ...appended];
}

/**
 * 给对比行生成稳定 key：内容相同的重复行（空段落等）按出现次数区分，
 * 不用数组下标，避免增删一行时整列重挂载。
 */
function keyedLines(lines: string[], sign: string) {
  const seen = new Map<string, number>();
  return lines.map((line, order) => {
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    return { line, order, key: `${sign}${line}#${count}` };
  });
}

function DiffLine({ sign, text, index }: { sign: "-" | "+"; text: string; index: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: sign === "-" ? -4 : 4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index, 12) * 0.012, ease: EASE_STANDARD }}
      className={cn(
        "flex gap-1.5 whitespace-pre-wrap break-words rounded-[4px] px-2 py-[3px] font-mono text-[11.5px] leading-relaxed",
        sign === "-" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
      )}
    >
      <span aria-hidden="true" className="shrink-0 select-none">
        {sign}
      </span>
      <span className="min-w-0">{text}</span>
    </motion.li>
  );
}

/**
 * MCP 写入的人工确认层：监听待审推送，在主界面弹出前后对比窗。
 *
 * 只有 Rust 判定「需要人工确认」的写入才会到这里；直写与只读工具不经过本层。
 */
export function AiReviewLayer({ showToast, workspaceId }: { showToast: ShowToast; workspaceId: string }) {
  const { t } = useI18n();
  const [queue, setQueue] = useState<AiReviewPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    let active = true;
    const unlisten = onAiReview((preview) => {
      if (!active) return;
      setQueue((items) => mergeQueue(items, [preview]));
    });
    return () => {
      active = false;
      unlisten.then((dispose) => dispose());
    };
  }, []);

  // 切换工作区后旧的待审弹窗不再对应当前库，收起队列由设置页继续处理。
  useEffect(() => {
    if (!workspaceId) return;
    setQueue([]);
    setError(null);
  }, [workspaceId]);

  /**
   * 补齐「入队时没人看见」的待审项。
   *
   * 只有事件推送会让这类写入永远不露面：MCP 在应用未开、刚重启、或工作区还没挂载
   * 确认层时入队，事件早就丢了，用户只会看到「已进入待审区」却不知道要确认什么。
   * 因此打开工作区时按 created_at 从旧到新取一批待审项重建对比。
   */
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    listAiInbox("pending")
      .then(async (items) => {
        const oldestFirst = items.slice(0, HYDRATION_MAX).reverse();
        const previews = await Promise.all(
          oldestFirst.map((item) => getAiReviewPreview(item.id).catch(() => null)),
        );
        if (!active) return;
        const fresh = previews.filter((preview): preview is AiReviewPreview => preview !== null);
        if (fresh.length > 0) setQueue((items2) => mergeQueue(items2, fresh));
      })
      .catch(() => {
        // 待审列表读不到时保持现状：确认层只是入口之一，设置页仍可处理。
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const settle = useCallback(
    async (preview: AiReviewPreview, action: "approve" | "reject") => {
      setBusy(true);
      setError(null);
      try {
        if (action === "approve") {
          await approveAiInbox(preview.inboxId);
          showToast(t("已执行 AI 写入"), "primary");
        } else {
          await rejectAiInbox(preview.inboxId);
          showToast(t("已拒绝该 AI 写入"), "primary");
        }
        setQueue((items) => items.filter((item) => item.inboxId !== preview.inboxId));
      } catch (caught) {
        setError(toErrorMessage(caught));
      } finally {
        setBusy(false);
      }
    },
    [showToast, t],
  );

  return (
    <Dialog open={current !== null} onOpenChange={(open) => !open && !busy && setQueue([])}>
      <DialogContent className="w-[620px] p-5" aria-describedby={undefined}>
        {current && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2">
                  <Bot className="size-4 text-primary" />
                  {t("AI 写入待确认")}
                </DialogTitle>
                <p className={cn(CAPTION_CLS, "mt-1 text-muted-foreground")}>
                  {current.tool} · {t("风险")} {t(RISK_LABELS[current.risk] ?? current.risk)}
                  {queue.length > 1 ? t(" · 还有 {count} 项待确认", { count: queue.length - 1 }) : ""}
                </p>
              </div>
              {current.risk === "high" && <Badge variant="solid">{t("高风险")}</Badge>}
            </div>

            <div className="mt-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
              <p className="text-[11.5px] text-muted-foreground">{t("目标")}</p>
              <p className="mt-0.5 min-w-0 break-all text-[12.5px] text-foreground">{current.target}</p>
              {current.summary && (
                <>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">{t("摘要")}</p>
                  <p className="mt-0.5 text-[12.5px] text-foreground">{current.summary}</p>
                </>
              )}
            </div>

            <div className="mt-3">
              <p className="text-[11.5px] font-medium text-muted-foreground">{t("变更对比")}</p>
              <ul
                aria-label={t("变更对比")}
                className="mt-1.5 max-h-[280px] space-y-0.5 overflow-y-auto rounded-md border border-border/70 bg-background p-1.5"
              >
                {current.removed.length === 0 && current.added.length === 0 ? (
                  <li className="px-2 py-1 text-[12px] text-muted-foreground">{t("本次写入不改动内容")}</li>
                ) : (
                  <>
                    {keyedLines(current.removed, "-").map((item) => (
                      <DiffLine key={item.key} sign="-" text={item.line} index={item.order} />
                    ))}
                    {keyedLines(current.added, "+").map((item) => (
                      <DiffLine key={item.key} sign="+" text={item.line} index={item.order} />
                    ))}
                  </>
                )}
              </ul>
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  role="alert"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden text-[12px] text-destructive"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setQueue([])}>
                {error ? t("关闭") : t("稍后处理")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void settle(current, "reject")}
              >
                {t("拒绝")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void settle(current, "approve")}>
                {t("确认执行")}
              </Button>
            </div>
            <p className={cn(CAPTION_CLS, "mt-2 text-right text-muted-foreground")}>
              {t("稍后处理：该项留在设置 → AI 协作的待审区，确认前不会写入。")}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
