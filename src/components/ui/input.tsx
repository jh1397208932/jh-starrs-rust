import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 输入框：38px 高、圆角 10、描边 --input、聚焦 --ring */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-[38px] w-full rounded-[10px] border border-input bg-card px-3 text-[13.5px] text-foreground transition-[border-color,box-shadow] duration-150 ease-[var(--ease)] placeholder:text-muted-foreground focus:border-ring focus:outline-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-55 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

/** 多行文本域（新建知识库-描述） */
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "min-h-[84px] w-full resize-none rounded-[10px] border border-input bg-card px-3 py-2.5 text-[13.5px] leading-relaxed text-foreground transition-[border-color] duration-150 ease-[var(--ease)] placeholder:text-muted-foreground focus:border-ring focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
