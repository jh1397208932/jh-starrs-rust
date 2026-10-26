import { Download, FileText, Loader2, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/attachment";
import { formatAttachmentBytes } from "../utils/format";

export interface AttachmentRowProps {
  item: Attachment;
  busy: string | null;
  pendingDelete: string | null;
  disabled: boolean;
  onCancelDelete: () => void;
  onDelete: (item: Attachment) => void;
  onExport: (item: Attachment) => void;
  onVerify: (item: Attachment) => void;
  onRestore: (item: Attachment) => void;
}

/** 附件列表行：文件名/逻辑目录/哈希摘要 + 校验/导出/删除。 */
export function AttachmentRow({
  item,
  busy,
  pendingDelete,
  disabled,
  onCancelDelete,
  onDelete,
  onExport,
  onVerify,
  onRestore,
}: AttachmentRowProps) {
  const { t } = useI18n();
  const deleted = item.status === "deleted";
  const referenced = item.referenceCount > 0;
  const itemBusy =
    busy === `export:${item.id}` ||
    busy === `verify:${item.id}` ||
    busy === `delete:${item.id}` ||
    busy === `restore:${item.id}`;
  const lifecycleLabel = deleted
    ? t("已删除 · 回收站")
    : item.referenceCount > 0
      ? t("{count} 处引用", { count: item.referenceCount })
      : item.expiresAt
        ? t("保留至 {time}", { time: formatTimestamp(item.expiresAt) })
        : t("未关联");
  return (
    <li
      className={cn(
        "flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0",
        deleted && "opacity-60",
      )}
    >
      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium" title={item.name}>
            {item.name}
          </span>
          {deleted && (
            <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
              {t("已删除")}
            </span>
          )}
          {itemBusy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <p className="truncate text-[10.5px] text-muted-foreground">
          {item.logicalPath || t("未分类")} · {lifecycleLabel} · {formatTimestamp(item.createdAt)}
        </p>
      </div>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
        {formatAttachmentBytes(item.size)}
      </span>
      {deleted ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("恢复 {name}", { name: item.name })}
          title={t("恢复")}
          disabled={disabled || itemBusy}
          onClick={() => onRestore(item)}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("校验 {name}", { name: item.name })}
            title={t("校验")}
            disabled={disabled}
            onClick={() => onVerify(item)}
          >
            <ShieldCheck className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("导出 {name}", { name: item.name })}
            title={t("导出")}
            disabled={disabled}
            onClick={() => onExport(item)}
          >
            <Download className="size-3.5" />
          </Button>
          {pendingDelete === item.id ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                className="h-[26px] px-2 text-[11.5px]"
                disabled={disabled}
                onClick={() => onDelete(item)}
              >
                {t("确认")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("取消删除")}
                title={t("取消")}
                onClick={onCancelDelete}
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("删除 {name}", { name: item.name })}
              title={referenced ? t("仍被 {count} 个位置引用", { count: item.referenceCount }) : t("删除")}
              disabled={disabled || referenced}
              onClick={() => onDelete(item)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
