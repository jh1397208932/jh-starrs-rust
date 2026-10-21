import { AnimatePresence, motion } from "motion/react";
import { Kbd } from "@/components/ui/empty-state";
import type { ToastState } from "@/hooks/useToast";
import { SPRING_TOAST } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface AppToastProps {
  /** 当前 toast 状态（null = 不渲染） */
  toast: ToastState | null;
}

/**
 * 全局 Toast 展示层（底部居中，3s 自动消失由 useToast 控制）：
 * 弹簧出入场；x 保持 -50% 居中；destructive 用 destructive 令牌配色。
 */
export function AppToast({ toast }: AppToastProps) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          role="status"
          initial={{ opacity: 0, y: 16, scale: 0.96, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: 8, scale: 0.98, x: "-50%" }}
          transition={SPRING_TOAST}
          className="fixed bottom-6 left-1/2 z-[70] flex items-center gap-2.5 rounded-[12px] border border-border bg-popover px-4 py-[11px] shadow-lg"
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full text-[11px]",
              toast.kind === "destructive"
                ? "bg-destructive text-destructive-foreground"
                : "bg-primary text-primary-foreground",
            )}
          >
            ✓
          </span>
          <span className="text-[13.5px] text-popover-foreground">{toast.message}</span>
          {toast.kbd && <Kbd>{toast.kbd}</Kbd>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
