import { ArrowUpRight, Cloud, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export interface ShareExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  kbName: string;
  wordCount: number;
  updatedAt: string;
  onMockExport: () => void;
}

/** 弹窗 H · 分享与导出：460px 模态，摘要卡 bg-accent + 两个导出选项 */
export function ShareExportDialog({
  open,
  onOpenChange,
  title,
  kbName,
  wordCount,
  updatedAt,
  onMockExport,
}: ShareExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[460px] p-5" aria-describedby={undefined}>
        <DialogTitle>分享与导出</DialogTitle>

        <div className="mt-4 flex items-start gap-3 rounded-md bg-accent p-4 text-accent-foreground">
          <FileText className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{title}</p>
            <p className="mt-0.5 text-[12px] opacity-80">
              {kbName} · {wordCount} 字 · 编辑于 {updatedAt}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onMockExport}
            className="flex cursor-default items-center gap-3 rounded-md border border-border bg-card p-3.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <FileText className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">导出为 Markdown</span>
              <span className="block text-[12px] text-muted-foreground">包含标题、列表与代码块</span>
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={onMockExport}
            className="flex cursor-default items-center gap-3 rounded-md border border-border bg-card p-3.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Cloud className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">发布到云</span>
              <span className="block text-[12px] text-muted-foreground">生成只读分享链接</span>
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </div>
        <DialogDescription className="sr-only">导出当前文档或发布到云</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
