import { FileCode2, FileDown, FileText, FileType2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ExportFormat } from "@/types/exchange";

export interface ExportKnowledgeBaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kbName: string;
  docCount: number;
  /** 选择导出目录并执行；返回 false 表示用户取消 */
  onExport: (format: ExportFormat) => Promise<boolean>;
}

const FORMATS: { id: ExportFormat; label: string; hint: string; icon: typeof FileText }[] = [
  { id: "markdown", label: "Markdown", hint: ".md", icon: FileText },
  { id: "html", label: "HTML", hint: ".html", icon: FileCode2 },
  { id: "docx", label: "Word", hint: ".docx", icon: FileType2 },
  { id: "pdf", label: "PDF", hint: ".pdf", icon: FileDown },
];

/** 整库导出弹窗：选择格式后按文件树导出，附带 manifest 与全部附件。 */
export function ExportKnowledgeBaseDialog({
  open,
  onOpenChange,
  kbName,
  docCount,
  onExport,
}: ExportKnowledgeBaseDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const done = await onExport(format);
      if (done) onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error && caught.message.trim() ? caught.message : "导出失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[520px] p-5" aria-describedby={undefined}>
        <DialogTitle>全部导出</DialogTitle>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          将「{kbName}」导出，共 {docCount} 项内容。文件夹层级会保留。
        </p>
        <p className="mt-2 text-[11.5px] text-muted-foreground">画板固定导出 Excalidraw、PNG、SVG。</p>

        <fieldset className="mt-4 grid grid-cols-2 gap-2">
          <legend className="sr-only">全部导出格式</legend>
          {FORMATS.map(({ id, label, hint, icon: Icon }) => (
            <label
              key={id}
              className={cn(
                "flex cursor-default items-start gap-2.5 rounded-md border p-3 text-left transition-colors duration-150 ease-[var(--ease)] has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring",
                format === id
                  ? "border-primary/45 bg-accent text-accent-foreground"
                  : "border-border bg-card hover:bg-secondary",
              )}
            >
              <input
                type="radio"
                name="kb-export-format"
                className="sr-only"
                checked={format === id}
                disabled={busy}
                onChange={() => setFormat(id)}
              />
              <Icon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                  {hint}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "正在导出…" : "导出"}
          </Button>
        </div>
        <DialogDescription className="sr-only">选择格式并导出整个知识库</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
