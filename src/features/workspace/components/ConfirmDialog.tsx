import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

/** 复用规格 5.3：320px 小模态；X 与「取消」等价，默认焦点在「取消」，Esc = 取消 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "删除",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[320px] p-5">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-destructive">{description}</DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          {/* 首个可聚焦元素 = 取消（Radix 默认聚焦它） */}
          <Button variant="ghost" size="sm" className="min-w-[72px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className={cn("min-w-[72px]")}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
