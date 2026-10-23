import { Download, FileText, Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/features/workspace/utils/tree";
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
}: AttachmentRowProps) {
  const deleted = item.status === "deleted";
  const itemBusy =
    busy === `export:${item.id}` || busy === `verify:${item.id}` || busy === `delete:${item.id}`;
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
            <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">已删除</span>
          )}
          {itemBusy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <p className="truncate text-[10.5px] text-muted-foreground">
          {item.logicalPath || "根目录"} · {item.mime} · {item.contentHash.slice(0, 12)} ·{" "}
          {formatTimestamp(item.createdAt)}
        </p>
      </div>
      <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
        {formatAttachmentBytes(item.size)}
      </span>
      {!deleted && (
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`校验 ${item.name}`}
            title="校验内容"
            disabled={disabled}
            onClick={() => onVerify(item)}
          >
            <ShieldCheck className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`导出 ${item.name}`}
            title="导出"
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
                确认
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="取消删除"
                title="取消"
                onClick={onCancelDelete}
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`删除 ${item.name}`}
              title="删除"
              disabled={disabled}
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
