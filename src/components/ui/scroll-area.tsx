import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 滚动区域：本阶段用原生 overflow + 细滚动条实现，
 * 后续接入 @radix-ui/react-scroll-area 时保持同一 API。
 */
export function ScrollArea({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("overflow-y-auto overscroll-contain", className)} {...props}>
      {children}
    </div>
  );
}
