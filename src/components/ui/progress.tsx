import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ProgressProps = ComponentProps<"div"> & { value: number };

/**
 * 进度条：填充 = glow 品牌渐变。
 * 动效约束（只动 transform/opacity）：宽度固定 100%，用 scaleX 呈现进度。
 */
export function Progress({ className, value, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-[7px] w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full w-full origin-left rounded-full bg-[linear-gradient(90deg,var(--glow-a),var(--glow-b))] transition-transform duration-1000 ease-[var(--ease)]"
        style={{ transform: `scaleX(${clamped / 100})` }}
      />
    </div>
  );
}
