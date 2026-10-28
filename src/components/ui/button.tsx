import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLMotionProps, motion } from "motion/react";
import { SPRING_PRESS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 按钮：高度 31/38/44 三档（UX_SPEC），圆角 10px，
 * 动效 = 颜色/透明度过渡（--dur-1）+ Motion 按压弹簧（whileTap，合成层动画）。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-default items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[color,background-color,opacity] duration-150 ease-[var(--ease)] active:opacity-90 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
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

export type ButtonProps = HTMLMotionProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: 0.97 }}
      transition={SPRING_PRESS}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
