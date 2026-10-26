import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export interface KbEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 新建或编辑 */
  mode: "create" | "edit";
  initialName?: string;
  initialDescription?: string;
  /** 异步提交；抛错时弹窗保留 */
  onSubmit: (name: string, description: string) => Promise<void>;
}

/** 知识库编辑弹窗：新建与重命名/改描述共用，400px 模态 */
export function KbEditorDialog({
  open,
  onOpenChange,
  mode,
  initialName = "",
  initialDescription = "",
  onSubmit,
}: KbEditorDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setPending(false);
    setError(null);
  }, [open, initialName, initialDescription]);

  const trimmed = name.trim();
  const nameError = trimmed.length === 0 ? t("请输入名称") : null;
  const canSubmit = nameError === null && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(trimmed, description.trim());
      onOpenChange(false);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[400px] p-5" aria-describedby={undefined}>
        <DialogTitle>{mode === "create" ? t("新建知识库") : t("编辑知识库")}</DialogTitle>

        <div className="mt-4">
          <label htmlFor="kb-name" className="mb-1.5 block text-[13px] font-medium">
            {t("名称")}
          </label>
          <Input
            id="kb-name"
            value={name}
            maxLength={80}
            placeholder={t("例如：产品灵感库")}
            aria-invalid={name.length > 0 && nameError !== null}
            onChange={(event) => setName(event.target.value)}
            className={name.length > 0 && nameError ? "border-destructive" : undefined}
          />
          {name.length > 0 && nameError && <p className="mt-1.5 text-[12px] text-destructive">{nameError}</p>}
        </div>

        <div className="mt-3">
          <label htmlFor="kb-desc" className="mb-1.5 block text-[13px] font-medium">
            {t("描述")} <span className="font-normal text-muted-foreground">{t("（选填）")}</span>
          </label>
          <Textarea
            id="kb-desc"
            value={description}
            maxLength={500}
            placeholder={t("简介")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button size="sm" className="min-w-[72px]" disabled={!canSubmit} onClick={() => void submit()}>
            {pending ? t("保存中…") : mode === "create" ? t("创建") : t("保存")}
          </Button>
        </div>
        <DialogDescription className="sr-only">
          {mode === "create" ? t("新建知识库") : t("编辑知识库")}
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
