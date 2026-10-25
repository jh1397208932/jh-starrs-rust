import { FileCode2, FileDown, FileText, FileType2, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { cn } from "@/lib/utils";
import type { ExportFormat } from "@/types/exchange";

export interface ShareExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  kbName: string;
  wordCount: number;
  /** 最近更新时间（Unix 毫秒） */
  updatedAt: number;
  /** 执行导出；父级负责选择路径与调用 IPC；返回 false 表示用户取消 */
  onExport: (format: ExportFormat) => Promise<boolean>;
}

const FORMATS: {
  id: ExportFormat;
  label: string;
  hint: string;
  icon: typeof FileText;
}[] = [
  {
    id: "markdown",
    label: "Markdown",
    hint: ".md · 便于继续编辑",
    icon: FileText,
  },
  { id: "html", label: "HTML", hint: ".html · 网页格式", icon: FileCode2 },
  { id: "docx", label: "Word", hint: ".docx · 可继续编辑", icon: FileType2 },
  { id: "pdf", label: "PDF", hint: ".pdf · 适合打印", icon: FileDown },
];

/** 弹窗 H · 导出文档：格式选择 + 摘要 + 执行状态。 */
export function ShareExportDialog({
  open,
  onOpenChange,
  title,
  kbName,
  wordCount,
  updatedAt,
  onExport,
}: ShareExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("markdown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runExport = async () => {
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
        <DialogTitle>导出文档</DialogTitle>

        <div className="mt-4 flex items-start gap-3 rounded-md bg-accent p-4 text-accent-foreground">
          <FileText className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{title}</p>
            <p className="mt-0.5 text-[12px] opacity-80">
              {kbName} · {wordCount} 字 · 编辑于 {formatTimestamp(updatedAt)}
            </p>
          </div>
        </div>

        <fieldset className="mt-4 grid grid-cols-2 gap-2">
          <legend className="sr-only">导出格式</legend>
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
                name="doc-export-format"
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
          <Button size="sm" disabled={busy} onClick={() => void runExport()}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {busy ? "正在导出…" : "导出"}
          </Button>
        </div>
        <DialogDescription className="sr-only">选择格式并导出当前文档</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
