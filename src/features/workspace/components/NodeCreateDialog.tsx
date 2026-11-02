import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { NODE_KIND_LABELS, NODE_KIND_ORDER, type NodeItem, type NodeKind } from "@/types/notebook";

/** 可创建的节点类型：文件夹 / 文档 / 画板 / 思维导图。 */
const CREATABLE_KINDS: NodeKind[] = NODE_KIND_ORDER;

export interface NodeCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 父文件夹；根级传 null */
  parent: NodeItem | null;
  /** 默认选中的类型 */
  defaultKind?: NodeKind;
  /** 打开时的初始标题 */
  initialTitle?: string;
  /** 创建并刷新；抛错时弹窗保留 */
  onSubmit: (kind: NodeKind, title: string) => Promise<void>;
}

/**
 * 新建节点弹窗：文件夹 / 文档 / 画板 / 思维导图。
 * 只有文件夹会作为入口出现；父级在打开前已由调用方校验。
 */
export function NodeCreateDialog({
  open,
  onOpenChange,
  parent,
  defaultKind = "doc",
  initialTitle = "",
  onSubmit,
}: NodeCreateDialogProps) {
  const { t } = useI18n();
  const [kind, setKind] = useState<NodeKind>(defaultKind);
  const [title, setTitle] = useState(initialTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKind(defaultKind);
    setTitle(initialTitle);
    setPending(false);
    setError(null);
  }, [open, defaultKind, initialTitle]);

  const trimmed = title.trim();
  const titleError =
    trimmed.length === 0 ? t("名称不能为空") : /[/\\]/.test(trimmed) ? t("名称不能包含 / 或 \\") : null;
  const canSubmit = titleError === null && !pending;

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(kind, trimmed);
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
      <DialogContent className="w-[440px] p-5" aria-describedby={undefined}>
        <DialogHeader title={parent ? t("在「{title}」中新建", { title: parent.title }) : t("新建")} />

        <fieldset
          aria-label={t("类型")}
          className="mt-4 grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${CREATABLE_KINDS.length}, minmax(0, 1fr))` }}
        >
          {CREATABLE_KINDS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={kind === item}
              disabled={pending}
              onClick={() => setKind(item)}
              className={cn(
                "flex cursor-default flex-col items-center gap-1.5 rounded-md border px-1 py-2.5 text-[12px] transition-colors duration-150 ease-[var(--ease)]",
                kind === item
                  ? "border-primary bg-accent font-semibold text-accent-foreground"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              <NodeKindIcon kind={item} className="size-4" />
              {t(NODE_KIND_LABELS[item])}
            </button>
          ))}
        </fieldset>

        <div className="mt-4">
          <label htmlFor="node-title" className="mb-1.5 block text-[13px] font-medium">
            {t(NODE_KIND_LABELS[kind])}
            {t("名称")}
          </label>
          <Input
            id="node-title"
            autoFocus
            value={title}
            maxLength={200}
            placeholder={t("名称")}
            aria-invalid={title.length > 0 && titleError !== null}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          {title.length > 0 && titleError && (
            <p className="mt-1.5 text-[12px] text-destructive">{titleError}</p>
          )}
        </div>

        {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            {t("取消")}
          </Button>
          <Button size="sm" className="min-w-[72px]" disabled={!canSubmit} onClick={() => void submit()}>
            {pending ? t("创建中…") : t("创建")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
