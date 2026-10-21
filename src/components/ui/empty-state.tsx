import type { ComponentProps, ReactNode } from "react";
import { BlurFade } from "@/components/common/motion/BlurFade";
import { CAPTION_CLS, cn } from "@/lib/utils";

/** kbd 组合键徽标（原型 .kbd：border-b-2 + mono 11px） */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[22px] items-center rounded-[6px] border border-border border-b-2 bg-card px-[7px] font-mono text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface EmptyStateProps {
  /** 34px 大字符（✦ / ☆ / ⛓ / ⌕） */
  glyph: string;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}

/**
 * 空状态：glyph 34px/.4 + 标题 body/700 + 说明 caption + 引导动作。
 * 元素按 glyph → 标题 → 说明 → 动作 分层模糊淡入（BlurFade stagger，
 * reduced-motion 时由 BlurFade 内部降级为直接呈现终态）。
 */
export function EmptyState({ glyph, title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center", className)}
    >
      <BlurFade>
        <span aria-hidden="true" className="block text-[34px] leading-none opacity-40">
          {glyph}
        </span>
      </BlurFade>
      <BlurFade delay={0.06}>
        <p className="mt-2 font-bold text-foreground">{title}</p>
      </BlurFade>
      <BlurFade delay={0.12}>
        <p className={cn(CAPTION_CLS, "max-w-[220px] text-muted-foreground")}>{description}</p>
      </BlurFade>
      {children && (
        <BlurFade delay={0.18}>
          <div className="mt-4">{children}</div>
        </BlurFade>
      )}
    </div>
  );
}
