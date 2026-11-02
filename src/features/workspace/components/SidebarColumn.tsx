import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SidebarColumnProps {
  /** 是否展开（折叠 = 布局瞬时收起 + 内容 transform 滑出） */
  open: boolean;
  /** 侧栏内容（Sidebar） */
  children: ReactNode;
}

/** 左列容器：232px 通高侧栏的折叠外壳（宽度 220ms 过渡 + 内容位滑出，避免主区瞬跳） */
export function SidebarColumn({ open, children }: SidebarColumnProps) {
  return (
    <div
      className={cn(
        "sidebar-column relative h-full shrink-0 overflow-hidden transition-[width] duration-[var(--dur-2)] ease-[var(--ease)]",
        open ? "w-[var(--sidebar-w)]" : "w-0",
      )}
    >
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
