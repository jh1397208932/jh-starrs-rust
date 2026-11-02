import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { t } from "@/lib/i18n";
import { EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 模态弹窗通用规格（UX_SPEC §3）：
 * 遮罩 = foreground 25% 纯色压暗（不做实时 backdrop-blur：全屏模糊层随透明度动画逐帧重算，
 * 是弹窗过渡掉帧的首要来源，2026-10-27 真机性能任务裁决）；容器 = popover + border + shadow-lg + radius-lg，
 * 只保留容器单层 12px 模糊（模糊预算：同屏实时模糊 ≤1 层、半径 ≤14px）；
 * 入出场 = opacity + scale(.975→1) + 上移 10px（标准缓动 --ease-out，大面板不做回弹）；
 * 出场用 Motion 真退场：Radix 关闭会立刻卸载内容，纯 CSS 的 closed 动画从未生效；
 * 遮罩与容器各自淡出，退场瞬间设 pointer-events:none，不再拦截点击。Esc 关闭、焦点由 Radix 管理。
 *
 * 关闭行为契约（统一收编，调用方不得自行 preventDefault）：
 * - 默认（dismissible = true）：右上角 ×、Esc、点击遮罩 三种方式均可关闭；
 * - dismissible = false：三种方式全部阻止——必须显式声明并注释业务原因。
 */

/** Content 需要知道 Root 的 open 才能驱动退场；Radix Root 本身不向子树暴露该状态。 */
const DialogOpenContext = createContext<{ open: boolean } | null>(null);

/**
 * 弹窗根：同时支持受控（open + onOpenChange）与非受控（defaultOpen）用法，
 * 并把解析后的 open 交给 Content 做进出场。
 */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof DialogPrimitive.Root>) {
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
    <DialogOpenContext.Provider value={{ open: resolvedOpen }}>
      <DialogPrimitive.Root {...props} open={resolvedOpen} onOpenChange={handleOpenChange} />
    </DialogOpenContext.Provider>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** 是否显示右上角关闭按钮（默认显示） */
  showClose?: boolean;
  /**
   * 是否允许 Esc / 点击遮罩关闭（默认允许）。
   * 设为 false 时三种关闭途径全部阻止——仅限确有业务理由的场景，并在调用处注释原因。
   */
  dismissible?: boolean;
  /**
   * 垂直定位：center = 垂直水平居中（默认）；top = 只做水平居中，由调用方给 top 值
   * （搜索面板避免被再抬半个高度）。
   */
  align?: "center" | "top";
}

const OVERLAY_CLASS = "fixed inset-0 z-40 bg-foreground/25";
const CONTENT_BASE =
  "fixed left-1/2 z-50 flex max-h-[86vh] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border/70 bg-popover/90 text-popover-foreground shadow-lg backdrop-blur-md backdrop-saturate-150 focus:outline-none";

export function DialogContent({
  className,
  children,
  showClose = true,
  dismissible = true,
  align = "center",
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  const state = useContext(DialogOpenContext);
  const open = state?.open ?? false;
  // 拖动：只在标题区/顶边条起拖，避免在输入框、按钮或选中文本时误拖整个弹窗。
  const dragControls = useDragControls();
  const viewportRef = useRef<HTMLElement | null>(document.body);
  /** dismissible=false 时统一阻止三种关闭途径（收编自各弹窗散落的 preventDefault） */
  const blockDismiss = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };

  return (
    <DialogPrimitive.Portal forceMount>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Overlay key="overlay" asChild forceMount>
            <motion.div
              initial={{ opacity: 0, pointerEvents: "auto" }}
              animate={{ opacity: 1, pointerEvents: "auto" }}
              exit={{
                opacity: 0,
                pointerEvents: "none",
                transition: { duration: 0.16, ease: EASE_STANDARD },
              }}
              transition={{ duration: 0.2, ease: EASE_STANDARD }}
              className={OVERLAY_CLASS}
            />
          </DialogPrimitive.Overlay>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Content
            key="content"
            asChild
            forceMount
            onEscapeKeyDown={(e) => {
              blockDismiss(e);
              onEscapeKeyDown?.(e);
            }}
            onPointerDownOutside={(e) => {
              blockDismiss(e);
              onPointerDownOutside?.(e);
            }}
            onInteractOutside={(e) => {
              blockDismiss(e);
              onInteractOutside?.(e);
            }}
            {...props}
          >
            <motion.div
              drag
              dragControls={dragControls}
              dragListener={false}
              dragMomentum={false}
              dragElastic={0.06}
              dragConstraints={viewportRef}
              onPointerDown={(event) => {
                const target = event.target as HTMLElement;
                if (!target.closest("[data-dialog-drag-handle]")) return;
                if (target.closest("button,a,input,textarea,select,[role=button]")) return;
                dragControls.start(event);
              }}
              initial={{ opacity: 0, scale: 0.975, y: 10, pointerEvents: "auto" }}
              animate={{ opacity: 1, scale: 1, y: 0, pointerEvents: "auto" }}
              exit={{
                opacity: 0,
                scale: 0.985,
                y: 6,
                pointerEvents: "none",
                transition: { duration: 0.16, ease: EASE_STANDARD },
              }}
              transition={{ duration: 0.2, ease: EASE_STANDARD }}
              className={cn(CONTENT_BASE, align === "center" && "top-1/2 -translate-y-1/2", className)}
            >
              {/* 顶边 10px 起拖区：不覆盖右上角关闭键（top-3 = 12px） */}
              <div
                data-dialog-drag-handle=""
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-2.5 cursor-grab active:cursor-grabbing"
              />
              {children}
              {showClose && (
                <DialogPrimitive.Close
                  aria-label={t("关闭")}
                  className="absolute top-3 right-3 grid size-8 cursor-default place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground"
                >
                  <X className="size-4" />
                </DialogPrimitive.Close>
              )}
            </motion.div>
          </DialogPrimitive.Content>
        )}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  );
}

export interface DialogHeaderProps {
  /** 弹窗标题（必填，走 DialogTitle 语义） */
  title: ReactNode;
  /** 可选描述（走 DialogDescription 语义，标题下方小字） */
  description?: ReactNode;
  /** 头部右侧动作区（如「新建知识库」按钮），自动避让右上角关闭按钮 */
  actions?: ReactNode;
  className?: string;
}

/**
 * 弹窗标准头部：标题 + 可选描述（左侧）与动作区（右侧），
 * 统一 pr-8 避让右上角关闭按钮与两列对齐结构——各弹窗不再手写头部布局。
 */
export function DialogHeader({ title, description, actions, className }: DialogHeaderProps) {
  return (
    <div
      data-dialog-drag-handle=""
      className={cn(
        "flex cursor-grab items-start justify-between gap-3 pr-8 select-none active:cursor-grabbing",
        className,
      )}
    >
      <div className="min-w-0">
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription className="mt-0.5">{description}</DialogDescription> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn(
        "text-[length:var(--text-h2)] font-bold leading-[var(--text-h2-lh)] tracking-[var(--text-h2-ls)]",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-[length:var(--text-caption)] font-medium leading-[var(--text-caption-lh)] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
