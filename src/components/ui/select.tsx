import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentProps, createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** 下拉选择：Content 走 Motion 真退场（Radix 关闭会立刻卸载内容）。 */

/** Content 需要 Root 的 open 才能驱动退场。 */
const SelectOpenContext = createContext<{ open: boolean } | null>(null);

/**
 * 选择器根：受控/非受控都可用，并把 open 交给 Content。
 *
 * 注意：Content 必须随关闭卸载，不能 `forceMount` 常驻 —— Radix 的 SelectContentImpl
 * 固定带 `disableOutsidePointerEvents: true`，常驻等于给整个窗口罩一层模态遮罩，
 * 真机表现为「打开过一次下拉后全界面点不动」（2026-10-28 全量 e2e 抓到的回归）。
 */
export function Select({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof SelectPrimitive.Root>) {
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
    <SelectOpenContext.Provider value={{ open: resolvedOpen }}>
      <SelectPrimitive.Root {...props} open={resolvedOpen} onOpenChange={handleOpenChange} />
    </SelectOpenContext.Provider>
  );
}

/**
 * 触发器上的当前值。
 *
 * Radix 只在「选中项仍挂载」时把选项文本 portal 回触发器；Content 关闭即卸载，
 * 所以当前值必须由调用方用 `label` 显式给出，否则触发器会显示为空白。
 */
export function SelectValue({
  label,
  ...props
}: ComponentProps<typeof SelectPrimitive.Value> & { label?: ReactNode }) {
  return <SelectPrimitive.Value {...props}>{label}</SelectPrimitive.Value>;
}

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "group flex h-[34px] w-full cursor-default items-center justify-between gap-2 rounded-[10px] border border-input bg-card px-3 text-[13.5px] text-foreground transition-[color,background-color,border-color] duration-150 ease-[var(--ease)] hover:border-border focus:border-ring focus:outline-none data-[placeholder]:text-muted-foreground data-[state=open]:border-ring [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="transition-transform duration-150 ease-[var(--ease)] group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  const open = useContext(SelectOpenContext)?.open ?? false;
  return (
    <SelectPrimitive.Portal forceMount>
      <AnimatePresence>
        {open && (
          <SelectPrimitive.Content
            key="select"
            asChild
            forceMount
            position={position}
            sideOffset={6}
            {...props}
          >
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
              transition={{ duration: 0.18, ease: EASE_STANDARD }}
              className={cn(
                "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover/95 p-1.5 text-popover-foreground shadow-md backdrop-blur-md backdrop-saturate-150 focus:outline-none [transform-origin:var(--radix-select-content-transform-origin)]",
                className,
              )}
            >
              <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
            </motion.div>
          </SelectPrimitive.Content>
        )}
      </AnimatePresence>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "flex cursor-default items-center justify-between gap-2 rounded-sm px-2.5 py-[7px] text-[13.5px] outline-none select-none transition-colors duration-150 ease-[var(--ease)] focus:bg-accent focus:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-3.5 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
