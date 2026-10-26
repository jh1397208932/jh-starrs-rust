import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** 危险操作确认；支持异步：失败时保留弹窗并展示错误 */
  onConfirm: () => void | Promise<void>;
  /** 描述下方的附加内容（如“同时删除文件夹”勾选） */
  children?: React.ReactNode;
}

/**
 * 复用规格 5.3：320px 小模态；X 与「取消」等价，默认焦点在「取消」，Esc = 取消。
 * 异步确认期间按钮禁用；失败不关闭，错误显示在描述下方。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[320px] p-5">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-destructive">{description}</DialogDescription>
        {children}
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          {/* 首个可聚焦元素 = 取消（Radix 默认聚焦它） */}
          <Button
            variant="ghost"
            size="sm"
            className="min-w-[72px]"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t("取消")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="min-w-[72px]"
            disabled={pending}
            onClick={() => void handleConfirm()}
          >
            {pending ? t("处理中…") : (confirmLabel ?? t("删除"))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
