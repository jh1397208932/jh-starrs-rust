import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "anim-fade-up z-50 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[12px] text-popover-foreground shadow-md focus:outline-none [transform-origin:var(--radix-tooltip-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
