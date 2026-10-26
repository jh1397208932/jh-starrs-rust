import { Loader2, Paperclip } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listAttachments } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { FileTypeIcon } from "@/features/attachments/components/FileTypeIcon";
import { useI18n } from "@/lib/i18n";
import type { Attachment } from "@/types/attachment";
import type { BoardAttachmentRecord } from "../hooks/useBoardFileIntake";

export interface AttachmentPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (records: BoardAttachmentRecord[]) => Promise<void>;
  onError: (message: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 从全局附件库选择对象插入画板；只引用 object_id，不复制字节。 */
export function AttachmentPickerDialog({
  open,
  onOpenChange,
  onInsert,
  onError,
}: AttachmentPickerDialogProps) {
  const { t } = useI18n();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [inserting, setInserting] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAttachments(await listAttachments());
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const handleInsert = async (attachment: Attachment) => {
    setInserting(attachment.id);
    try {
      await onInsert([
        {
          objectId: attachment.id,
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
        },
      ]);
      onOpenChange(false);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setInserting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[560px] max-w-[92vw] gap-4 p-5">
        <DialogHeader title={t("插入附件")} />
        <div className="min-h-[220px] max-h-[55vh] overflow-y-auto rounded-[12px] border border-border/60">
          {loading ? (
            <div className="flex h-[220px] items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("正在读取附件…")}
            </div>
          ) : attachments.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
              <Paperclip className="size-7 text-muted-foreground/60" />
              <p className="text-[13px] font-medium text-foreground">{t("还没有附件")}</p>
            </div>
          ) : (
            <ul aria-label={t("附件列表")}>
              {attachments.map((attachment) => (
                <li key={attachment.id} className="border-b border-border/50 last:border-b-0">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left"
                    disabled={inserting !== null}
                    onClick={() => void handleInsert(attachment)}
                  >
                    <FileTypeIcon
                      fileName={attachment.name}
                      mime={attachment.mime}
                      size="row"
                      className="h-8 w-7 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {attachment.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {formatSize(attachment.size)}
                        {attachment.logicalPath ? ` · ${attachment.logicalPath}` : ""}
                      </span>
                    </span>
                    {inserting === attachment.id ? (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    ) : null}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
