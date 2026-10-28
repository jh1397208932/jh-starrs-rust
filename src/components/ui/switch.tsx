import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 开关：42×24；底色 220ms 匀速过渡，滑块走弹性曲线（设计语言 §6 允许的点睛弹性） */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-[42px] shrink-0 cursor-default items-center rounded-full border-2 border-transparent bg-input transition-colors duration-[var(--dur-2)] ease-[var(--ease)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-[19px] rounded-full bg-card shadow-sm transition-transform duration-[var(--dur-2)] ease-[var(--ease-spring)] data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
