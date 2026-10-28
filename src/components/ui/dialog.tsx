import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * 模态弹窗通用规格（UX_SPEC §3）：
 * 遮罩 = foreground 32% 纯色压暗（不做实时 backdrop-blur：全屏模糊层随透明度动画逐帧重算，
 * 是弹窗过渡掉帧的首要来源，2026-10-27 真机性能任务裁决）；容器 = popover + border + shadow-lg + radius-lg，
 * 只保留容器单层 12px 模糊（模糊预算：同屏实时模糊 ≤1 层、半径 ≤14px）；
 * 入出场 = opacity + scale(.97→1) + 上移 8px，时长 --dur-2 / 微回弹 --ease-pop；Esc 关闭、焦点由 Radix 管理。
 *
 * 关闭行为契约（统一收编，调用方不得自行 preventDefault）：
 * - 默认（dismissible = true）：右上角 ×、Esc、点击遮罩 三种方式均可关闭；
 * - dismissible = false：三种方式全部阻止——必须显式声明并注释业务原因。
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "anim-fade-in data-[state=closed]:anim-fade-out fixed inset-0 z-40 bg-foreground/25",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  /** 是否显示右上角关闭按钮（默认显示） */
  showClose?: boolean;
  /**
   * 是否允许 Esc / 点击遮罩关闭（默认允许）。
   * 设为 false 时三种关闭途径全部阻止——仅限确有业务理由的场景，并在调用处注释原因。
   */
  dismissible?: boolean;
}

export function DialogContent({
  className,
  children,
  showClose = true,
  dismissible = true,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: DialogContentProps) {
  /** dismissible=false 时统一阻止三种关闭途径（收编自各弹窗散落的 preventDefault） */
  const blockDismiss = (e: Event) => {
    if (!dismissible) e.preventDefault();
  };

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
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
        className={cn(
          "anim-dialog-in data-[state=closed]:anim-dialog-out fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] flex-col overflow-hidden rounded-lg border border-border/70 bg-popover/94 text-popover-foreground shadow-lg backdrop-blur-md focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <DialogPrimitive.Close
            aria-label={t("关闭")}
            className="absolute top-3 right-3 grid size-8 cursor-default place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground"
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
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
    <div className={cn("flex items-start justify-between gap-3 pr-8", className)}>
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
