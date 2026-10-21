"use client";

import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { type ComponentPropsWithoutRef, useEffect, useRef } from "react";

import { SPRING_TICKER } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 数字滚动（来源：Magic UI number-ticker，MIT，2026-10-20 复制）。
 * 改造点：①zh-CN 数字格式（千位逗号）；②移除写死的黑白文字色，颜色交给调用方；
 * ③prefers-reduced-motion 时直接渲染终值，不做动画。
 *
 * @param value 目标数值（变化时会弹簧过渡到新值）
 * @param startValue 起始数值（默认 0）
 * @param delay 进入视口后的延迟秒数
 * @param decimalPlaces 小数位（默认 0）
 */
export interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number;
  startValue?: number;
  direction?: "up" | "down";
  delay?: number;
  decimalPlaces?: number;
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(direction === "down" ? value : startValue);
  const springValue = useSpring(motionValue, SPRING_TICKER);
  const isInView = useInView(ref, { once: true, margin: "0px" });

  useEffect(() => {
    // 降低动效：跳过弹簧，直接呈现终值
    if (reduceMotion) {
      motionValue.jump(direction === "down" ? startValue : value);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (isInView) {
      timer = setTimeout(() => {
        motionValue.set(direction === "down" ? startValue : value);
      }, delay * 1000);
    }

    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [motionValue, isInView, delay, value, direction, startValue, reduceMotion]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) {
          ref.current.textContent = Intl.NumberFormat("zh-CN", {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(Number(latest.toFixed(decimalPlaces)));
        }
      }),
    [springValue, decimalPlaces],
  );

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {startValue}
    </span>
  );
}
