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
        "-mb-px cursor-default border-b-2 border-transparent px-[15px] pt-2 pb-[9px] text-[13.5px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:text-foreground data-[state=active]:border-primary data-[state=active]:font-[650] data-[state=active]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  // 激活切换时内容淡入上移（复用全局 anim-slide-up-in，transform/opacity 合成层动画）。
  return <TabsPrimitive.Content className={cn("anim-slide-up-in flex-1 outline-none", className)} {...props} />;
}
