import React, { type ComponentPropsWithoutRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * 扫光按钮（来源：Magic UI shimmer-button，MIT，2026-10-20 复制）。
 * 改造点：①颜色全部令牌化——默认 --primary 底 + --logo-c 暖金扫光 + --primary-foreground 文字；
 * ②keyframes 使用 app.css 的 starris-shimmer-slide / starris-spin-around；③移除上游暗色硬编码。
 * 纯 CSS 动画（不占 JS 线程）；prefers-reduced-motion 由 app.css 全局禁用兜底。
 *
 * @param shimmerColor 扫光颜色（默认暖金 --logo-c）
 * @param shimmerDuration 一轮扫光时长（默认 3s）
 * @param background 底色（默认 --primary）
 */
export interface ShimmerButtonProps extends ComponentPropsWithoutRef<"button"> {
  shimmerColor?: string;
  shimmerSize?: string;
  shimmerDuration?: string;
  borderRadius?: string;
  background?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = "var(--logo-c)",
      shimmerSize = "0.05em",
      shimmerDuration = "3s",
      borderRadius = "100px",
      background = "var(--primary)",
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        style={
          {
            "--spread": "90deg",
            "--shimmer-color": shimmerColor,
            "--radius": borderRadius,
            "--speed": shimmerDuration,
            "--cut": shimmerSize,
            "--bg": background,
          } as CSSProperties
        }
        className={cn(
          "group relative z-0 flex cursor-default items-center justify-center overflow-hidden [border-radius:var(--radius)] border border-white/15 px-6 py-3 whitespace-nowrap text-[color:var(--primary-foreground)] [background:var(--bg)]",
          "transform-gpu transition-transform duration-150 ease-[var(--ease)] active:translate-y-px",
          className,
        )}
        ref={ref}
        {...props}
      >
        {/* 扫光容器：container query 单位供 keyframes 计算行程 */}
        <div className={cn("-z-30 blur-[2px]", "@container-[size] absolute inset-0 overflow-visible")}>
          {/* 旋转扫光片 */}
          <div className="animate-shimmer-slide absolute inset-0 aspect-[1] h-[100cqh] rounded-none [mask:none]">
            <div className="animate-spin-around absolute -inset-full w-auto [translate:0_0] rotate-0 [background:conic-gradient(from_calc(270deg-(var(--spread)*0.5)),transparent_0,var(--shimmer-color)_var(--spread),transparent_var(--spread))]" />
          </div>
        </div>
        {children}

        {/* 内高光层：hover/active 时增强 */}
        <div
          className={cn(
            "absolute inset-0 size-full",
            "rounded-2xl px-4 py-1.5 text-sm font-medium shadow-[inset_0_-8px_10px_#ffffff1f]",
            "transform-gpu transition-all duration-150 ease-[var(--ease)]",
            "group-hover:shadow-[inset_0_-6px_10px_#ffffff3f]",
            "group-active:shadow-[inset_0_-10px_10px_#ffffff3f]",
          )}
        />

        {/* 背板：内缩 --cut 形成边缘透光 */}
        <div className="absolute inset-(--cut) -z-20 [border-radius:var(--radius)] [background:var(--bg)]" />
      </button>
    );
  },
);

ShimmerButton.displayName = "ShimmerButton";
