import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 下划线式 tab（原型 .tab）：激活 = 主色 + 650 字重 + 2px 底线 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex items-center gap-2 border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        // 下划线用 ::after 从中间展开（transform/opacity），避免切换时 2px 边框突然跳格；
        // 触发器本身保留透明下边框占位，高度不随激活态变化。
        "relative -mb-px cursor-default border-b-2 border-transparent px-[15px] pt-2 pb-[9px] text-[13.5px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] after:absolute after:inset-x-[15px] after:-bottom-0.5 after:h-0.5 after:origin-center after:scale-x-0 after:rounded-full after:bg-primary after:opacity-0 after:transition-[scale,opacity] after:duration-[var(--dur-2)] after:ease-[var(--ease)] hover:text-foreground data-[state=active]:font-[650] data-[state=active]:text-primary data-[state=active]:after:scale-x-100 data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  // 激活切换时内容淡入上移（复用全局 anim-slide-up-in，transform/opacity 合成层动画）。
  return (
    <TabsPrimitive.Content className={cn("anim-slide-up-in flex-1 outline-none", className)} {...props} />
  );
}
