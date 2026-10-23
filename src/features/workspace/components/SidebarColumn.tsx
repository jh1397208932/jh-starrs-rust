import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SidebarColumnProps {
  /** 是否展开（折叠 = 布局瞬时收起 + 内容 transform 滑出） */
  open: boolean;
  /** 侧栏内容（Sidebar） */
  children: ReactNode;
}

/** 左列容器：232px 通高侧栏的折叠动画外壳（布局宽度瞬时切换 + 内容位滑出） */
export function SidebarColumn({ open, children }: SidebarColumnProps) {
  return (
    <div className={cn("relative h-full shrink-0", open ? "w-[var(--sidebar-w)]" : "w-0")}>
      <div
        className="absolute inset-y-0 left-0 w-[var(--sidebar-w)] transition-transform ease-[var(--ease)]"
        style={{
          transitionDuration: "var(--dur-2)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
