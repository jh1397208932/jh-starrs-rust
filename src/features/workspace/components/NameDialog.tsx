import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 标题下方说明 */
  description?: string;
  /** 输入框标签 */
  label: string;
  /** 打开时的初始值 */
  initialValue: string;
  placeholder?: string;
  maxLength: number;
  submitLabel: string;
  /** 提交；抛错时弹窗保留并显示错误 */
  onSubmit: (value: string) => Promise<void>;
}

/**
 * 通用单字段命名弹窗：工作区改名、节点重命名共用。
 * 关闭后重置输入与错误；异步提交期间禁用按钮。
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initialValue,
  placeholder,
  maxLength,
  submitLabel,
  onSubmit,
}: NameDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setPending(false);
      setError(null);
    }
  }, [open, initialValue]);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= maxLength && !pending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[380px] p-5" aria-describedby={undefined}>
        <DialogHeader title={title} description={description} />
        <div className="mt-4">
          <label htmlFor="name-dialog-input" className="mb-1.5 block text-[13px] font-medium">
            {label}
          </label>
          <Input
            id="name-dialog-input"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-invalid={error !== null}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            className={error ? "border-destructive" : undefined}
          />
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            {trimmed.length}/{maxLength}
          </p>
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button
            size="sm"
            className="min-w-[72px]"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {pending ? t("保存中…") : submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
