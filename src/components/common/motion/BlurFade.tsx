"use client";

import {
  AnimatePresence,
  type MotionProps,
  motion,
  type UseInViewOptions,
  useInView,
  useReducedMotion,
  type Variants,
} from "motion/react";
import { useRef } from "react";

import { EASE_STANDARD, TRANSITION_REVEAL } from "@/lib/motion";

type MarginType = UseInViewOptions["margin"];

/**
 * 模糊淡入入场（来源：Magic UI blur-fade，MIT，2026-10-20 复制）。
 * 改造点：①prefers-reduced-motion 时直接渲染终态；②其余逻辑保持上游实现。
 * 用于空状态/列表等内容的分层入场（配合 delay 做 stagger）。
 *
 * @param direction 入场位移方向（默认 down = 从上方 -6px 进入）
 * @param offset 位移像素（默认 6px，守则要求 ≤12px）
 * @param blur 初始模糊（默认 6px，守则要求 ≤6px）
 * @param duration 时长秒数（默认 0.4，接近 --dur-2/3 之间）
 * @param delay 延迟秒数（stagger 用）
 * @param inView 是否由视口进入触发（默认 false = 挂载即入场）
 */
export interface BlurFadeProps extends MotionProps {
  children: React.ReactNode;
  className?: string;
  variant?: {
    hidden: { y: number };
    visible: { y: number };
  };
  duration?: number;
  delay?: number;
  offset?: number;
  direction?: "up" | "down" | "left" | "right";
  inView?: boolean;
  inViewMargin?: MarginType;
  blur?: string;
}

const getFilter = (v: Variants[string]) => (typeof v === "function" ? undefined : v.filter);

export function BlurFade({
  children,
  className,
  variant,
  duration = TRANSITION_REVEAL.duration, // 默认时长取动效预设，可按场景覆盖
  delay = 0,
  offset = 6,
  direction = "down",
  inView = false,
  inViewMargin = "-50px",
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const ref = useRef(null);
  const reduceMotion = useReducedMotion();
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin });
  const isInView = !inView || inViewResult;
  const defaultVariants: Variants = {
    hidden: {
      [direction === "left" || direction === "right" ? "x" : "y"]:
        direction === "right" || direction === "down" ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      [direction === "left" || direction === "right" ? "x" : "y"]: 0,
      opacity: 1,
      filter: "blur(0px)",
    },
  };
  const combinedVariants = variant ?? defaultVariants;

  const hiddenFilter = getFilter(combinedVariants.hidden);
  const visibleFilter = getFilter(combinedVariants.visible);

  const shouldTransitionFilter =
    hiddenFilter != null && visibleFilter != null && hiddenFilter !== visibleFilter;

  // 降低动效：直接呈现终态，不做入场动画（仍用 motion.div 以兼容 MotionProps 类型）
  if (reduceMotion) {
    return (
      <motion.div ref={ref} initial={false} className={className} {...props}>
        {children}
      </motion.div>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={combinedVariants}
        transition={{
          delay: 0.04 + delay,
          duration,
          ease: EASE_STANDARD,
          ...(shouldTransitionFilter ? { filter: { duration } } : {}),
        }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
