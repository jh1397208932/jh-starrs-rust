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
  /** 小空态字形（✦ / ☆ / ⛓ / ⌕）；hero 变体改用星屿线稿 */
  glyph: string;
  title: string;
  description?: string;
  /**
   * hero = 主内容区空态：星屿线稿 + 宋体大标题 + 雾光背景；
   * panel = 浮窗 / 占位小空态：字形底片 + 常规标题。
   */
  variant?: "hero" | "panel";
  /** hero 上方的英文眉标（例如 STARRIS · LOCAL WORKSPACE） */
  eyebrow?: string;
  children?: ReactNode;
  className?: string;
}

/**
 * 空状态：hero 变体按「线稿 → 眉标 → 宋体标题 → 说明 → 动作」分层模糊淡入；
 * panel 变体保持紧凑。reduced-motion 时由 BlurFade 内部降级为直接呈现终态。
 */
export function EmptyState({
  glyph,
  title,
  description,
  variant = "panel",
  eyebrow,
  children,
  className,
}: EmptyStateProps) {
  if (variant === "hero") {
    return (
      <div className={cn("empty-hero", className)}>
        <BlurFade>
          <div className="empty-art" aria-hidden="true">
            <span className="empty-art__tile">
              <svg className="empty-art__star" viewBox="0 0 48 48" fill="none">
                <title>星屿线稿：星与岛屿</title>
                <path
                  d="M24 8.5l3.4 7.6 8.2 1-6 5.6 1.6 8.1-7.2-3.9-7.2 3.9 1.6-8.1-6-5.6 8.2-1L24 8.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  fill="currentColor"
                  fillOpacity="0.14"
                />
                <path
                  d="M11 35.5c4.6-1.7 8-2.6 13-2.6s8.4.9 13 2.6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  opacity="0.55"
                />
                <path
                  d="M16 40h16"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  opacity="0.28"
                />
                <circle cx="37" cy="13" r="2.4" fill="var(--logo-c)" />
              </svg>
            </span>
          </div>
        </BlurFade>
        {eyebrow && (
          <BlurFade delay={0.05}>
            <p className="empty-eyebrow">{eyebrow}</p>
          </BlurFade>
        )}
        <BlurFade delay={0.1}>
          <h2 className="empty-title">{title}</h2>
        </BlurFade>
        {description && (
          <BlurFade delay={0.16}>
            <p className="empty-desc">{description}</p>
          </BlurFade>
        )}
        {children && (
          <BlurFade delay={0.22}>
            <div className="empty-actions">{children}</div>
          </BlurFade>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center", className)}
    >
      <BlurFade>
        <span aria-hidden="true" className="empty-panel-glyph">
          {glyph}
        </span>
      </BlurFade>
      <BlurFade delay={0.06}>
        <p className="mt-3 text-[15px] font-semibold text-foreground">{title}</p>
      </BlurFade>
      {description && (
        <BlurFade delay={0.12}>
          <p className={cn(CAPTION_CLS, "max-w-[220px] text-muted-foreground")}>{description}</p>
        </BlurFade>
      )}
      {children && (
        <BlurFade delay={0.18}>
          <div className="mt-4">{children}</div>
        </BlurFade>
      )}
    </div>
  );
}
