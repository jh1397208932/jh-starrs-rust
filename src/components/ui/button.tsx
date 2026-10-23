import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * 按钮：高度 31/38/44 三档（UX_SPEC），圆角 10px，
 * 动效只做颜色/透明度过渡（--dur-1）。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[color,background-color,opacity] duration-150 ease-[var(--ease)] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground ring-1 ring-primary/20 ring-inset hover:bg-primary/15",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "text-foreground hover:bg-accent/70 hover:text-accent-foreground",
        outline:
          "border border-border/80 bg-card text-foreground hover:bg-accent/60 hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-accent-foreground underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-[31px] px-3 text-[13px]",
        default: "h-[38px] px-4 text-[13.5px]",
        lg: "h-[44px] px-5 text-[15px]",
        /** 图标按钮：32px 热区 */
        icon: "size-8 rounded-md",
        "icon-sm": "size-[26px] rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
