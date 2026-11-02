import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentProps, createContext, useCallback, useContext, useState } from "react";
import { EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 锚定浮层菜单（更多菜单 / 工作空间切换浮层 / 行内 ⋯ 菜单）。
 * 出场用 Motion 真退场：Radix 关闭会立刻卸载内容，纯 CSS 的 closed 动画从未生效；
 * 退场 120ms、瞬间 pointer-events:none，菜单不会“啪”地消失。
 */

/** 菜单进出场：入场 180ms（原生菜单偏快，不用 220ms），退场 120ms。 */
const EASE_STANDARD_TRANSITION = {
  duration: 0.18,
  ease: EASE_STANDARD,
} as const;

/** Content 需要 Root 的 open 才能驱动退场。 */
const DropdownOpenContext = createContext<{ open: boolean } | null>(null);

/** 菜单根：受控/非受控都可用，并把 open 交给 Content。 */
export function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen ?? false);
  const resolvedOpen = open ?? uncontrolled;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (open === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [open, onOpenChange],
  );
  return (
    <DropdownOpenContext.Provider value={{ open: resolvedOpen }}>
      <DropdownMenuPrimitive.Root {...props} open={resolvedOpen} onOpenChange={handleOpenChange} />
    </DropdownOpenContext.Provider>
  );
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const open = useContext(DropdownOpenContext)?.open ?? false;
  return (
    <DropdownMenuPrimitive.Portal forceMount>
      <AnimatePresence>
        {open && (
          <DropdownMenuPrimitive.Content key="menu" asChild forceMount sideOffset={sideOffset} {...props}>
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 6, pointerEvents: "auto" }}
              animate={{ opacity: 1, scale: 1, y: 0, pointerEvents: "auto" }}
              exit={{
                opacity: 0,
                scale: 0.98,
                y: 2,
                pointerEvents: "none",
                transition: { duration: 0.12, ease: EASE_STANDARD },
              }}
              transition={EASE_STANDARD_TRANSITION}
              className={cn(
                // transform-origin 跟随 Radix 触发器：菜单从触发按钮方向展开，而不是从自身中心“弹出来”。
                "z-50 min-w-[220px] rounded-[14px] border border-border/70 bg-popover/90 p-1.5 text-popover-foreground shadow-lg backdrop-blur-md backdrop-saturate-150 focus:outline-none [transform-origin:var(--radix-dropdown-menu-content-transform-origin)]",
                className,
              )}
            >
              {children}
            </motion.div>
          </DropdownMenuPrimitive.Content>
        )}
      </AnimatePresence>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm px-2.5 py-[7px] text-[13.5px] text-foreground outline-none select-none transition-colors duration-150 ease-[var(--ease)] focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2.5 py-1.5 text-[11.5px] font-medium tracking-[0.3px] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn("-mx-1.5 my-1 h-px bg-border", className)} {...props} />
  );
}
