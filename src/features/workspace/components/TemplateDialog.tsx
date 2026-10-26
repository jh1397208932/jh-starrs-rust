import { FileText, LayoutTemplate, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { createFromTemplate, deleteTemplate, listTemplates, saveTemplate } from "@/api/template";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NodeItem } from "@/types/notebook";
import type { TemplateSummary } from "@/types/template";

export interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前活动节点；只有文档/画板可另存为模板 */
  currentNode: NodeItem | null;
  knowledgeBaseId: string;
  onCreated: (node: NodeItem) => void;
}

/**
 * 模板库：列表、另存当前内容、从模板创建节点、删除模板。
 */
export function TemplateDialog({
  open,
  onOpenChange,
  currentNode,
  knowledgeBaseId,
  onCreated,
}: TemplateDialogProps) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const canSave = currentNode?.kind === "doc" || currentNode?.kind === "board";

  useEffect(() => {
    if (!open) return;
    setName(currentNode?.title ?? "");
    setPendingDelete(null);
    setError(null);
    setLoading(true);
    void listTemplates()
      .then(setTemplates)
      .catch((caught) => setError(toErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [open, currentNode?.title]);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const saveCurrent = () =>
    run("save", async () => {
      if (!currentNode) return;
      const saved = await saveTemplate({
        nodeId: currentNode.id,
        name: name.trim() || currentNode.title,
      });
      setTemplates((current) => [saved, ...current]);
      setName("");
    });

  const applyTemplate = (template: TemplateSummary) =>
    run(`use:${template.id}`, async () => {
      const result = await createFromTemplate({
        templateId: template.id,
        knowledgeBaseId,
        title: template.name,
      });
      onCreated(result.node);
      onOpenChange(false);
    });

  const removeTemplate = (template: TemplateSummary) => {
    if (pendingDelete !== template.id) {
      setPendingDelete(template.id);
      return;
    }
    void run(`delete:${template.id}`, async () => {
      await deleteTemplate(template.id);
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setPendingDelete(null);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[540px] p-5" aria-describedby={undefined}>
        <DialogTitle>{t("模板库")}</DialogTitle>

        <div className="mt-4 flex items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={canSave ? t("模板名称") : t("打开文档或画板后可另存为模板")}
            aria-label={t("模板名称")}
            className="h-8"
            disabled={!canSave || busy !== null}
          />
          <Button size="sm" disabled={!canSave || busy !== null} onClick={() => void saveCurrent()}>
            {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : t("另存为模板")}
          </Button>
        </div>

        <div className="mt-3 max-h-[340px] overflow-y-auto rounded-md border border-border/70">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t("正在读取模板…")}
            </div>
          ) : templates.length === 0 ? (
            <div className="py-10 text-center text-[12.5px] text-muted-foreground">
              <LayoutTemplate className="mx-auto mb-2 size-5 opacity-60" />
              {t("还没有模板")}
            </div>
          ) : (
            <ul aria-label={t("模板列表")}>
              {templates.map((template) => {
                const Icon = template.kind === "board" ? LayoutTemplate : FileText;
                return (
                  <li
                    key={template.id}
                    className="flex items-center gap-2.5 border-b border-border/50 px-3 py-2.5 last:border-b-0"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{template.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {template.kind === "board" ? t("画板") : t("文档")}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={t("使用模板 {name}", { name: template.name })}
                      onClick={() => void applyTemplate(template)}
                    >
                      {busy === `use:${template.id}` ? t("创建中…") : t("使用")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy !== null}
                      aria-label={
                        pendingDelete === template.id
                          ? t("确认删除模板 {name}", { name: template.name })
                          : t("删除模板 {name}", { name: template.name })
                      }
                      onClick={() => removeTemplate(template)}
                      className={cn(pendingDelete === template.id && "text-destructive")}
                    >
                      <Trash2 className="size-3.5" />
                      {pendingDelete === template.id ? t("确认删除") : ""}
                    </Button>
                  </li>
                );
              })}
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
