"use client";

import { type HTMLMotionProps, motion, useMotionTemplate, useMotionValue } from "motion/react";
import type React from "react";
import { useCallback, useEffect } from "react";

import { cn } from "@/lib/utils";

/**
 * 跟随鼠标的渐变边卡片（来源：Magic UI magic-card，MIT，2026-10-20 复制）。
 * 改造点：①仅保留 gradient 模式（移除 orb 与 next-themes 依赖）；②
 * 边框渐变的底色/分隔色映射到本项目令牌（--card / --border），默认聚光色改为暖屿橙低透明；
 * ③悬浮才显现聚光（opacity 0→1），键盘用户无指针不误触。
 *
 * @param gradientSize 聚光半径 px（默认 200）
 * @param gradientColor 聚光填充色（默认暖屿橙 8% 透明）
 * @param gradientFrom/gradientTo 边框渐变两端色（默认主题 logo 渐变）
 * @param gradientOpacity 聚光层不透明度（默认 0.6，克制）
 */
export interface MagicCardProps extends HTMLMotionProps<"div"> {
  children?: React.ReactNode;
  className?: string;
  gradientSize?: number;
  gradientColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  gradientOpacity?: number;
}

export function MagicCard({
  children,
  className,
  gradientSize = 200,
  gradientColor = "rgba(232, 114, 42, 0.08)",
  gradientFrom = "var(--logo-a)",
  gradientTo = "var(--logo-c)",
  gradientOpacity = 0.6,
  ...props
}: MagicCardProps) {
  const mouseX = useMotionValue(-gradientSize);
  const mouseY = useMotionValue(-gradientSize);
  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      mouseX.set(e.clientX - rect.left);
      mouseY.set(e.clientY - rect.top);
    },
    [mouseX, mouseY],
  );

  const reset = useCallback(() => {
    mouseX.set(-gradientSize);
    mouseY.set(-gradientSize);
  }, [gradientSize, mouseX, mouseY]);

  // 指针离开窗口 / 页面隐藏时复位，避免残留光斑
  useEffect(() => {
    const handleGlobalPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) reset();
    };
    const handleBlur = () => reset();
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") reset();
    };

    window.addEventListener("pointerout", handleGlobalPointerOut);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("pointerout", handleGlobalPointerOut);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [reset]);

  useEffect(() => {
    reset();
  }, [reset]);

  return (
    <motion.div
      className={cn(
        "group relative isolate overflow-hidden rounded-[inherit] border border-transparent",
        className,
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      onPointerEnter={() => {}}
      {...props}
      style={{
        background: useMotionTemplate`
          linear-gradient(var(--card) 0 0) padding-box,
          radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
            ${gradientFrom},
            ${gradientTo},
            var(--border) 100%
          )
        `,
      }}
    >
      {/* 内容底板：盖住 border-box 渐变的内侧，只露出边缘 1px */}
      <div className="absolute inset-px z-20 rounded-[inherit] bg-card" />

      {/* 悬浮聚光层：跟随指针的柔光 */}
      <motion.div
        className="pointer-events-none absolute inset-px z-30 rounded-[inherit] opacity-0 transition-opacity duration-300 ease-[var(--ease)] group-hover:opacity-100"
        style={{
          background: useMotionTemplate`
            radial-gradient(${gradientSize}px circle at ${mouseX}px ${mouseY}px,
              ${gradientColor},
              transparent 100%
            )
          `,
          opacity: gradientOpacity,
        }}
      />
      <div className="relative z-40">{children}</div>
    </motion.div>
  );
}
