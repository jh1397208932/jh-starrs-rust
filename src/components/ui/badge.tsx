import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** 徽标：22px 高、胶囊形、11.5px/600 */
const badgeVariants = cva(
  "inline-flex h-[22px] w-fit shrink-0 items-center gap-[5px] rounded-full px-[9px] text-[11.5px] font-semibold leading-none whitespace-nowrap",
  {
    variants: {
      variant: {
        /** 文档徽标 badge-doc */
        doc: "bg-accent text-accent-foreground",
        /** 画板/表格徽标 badge-board */
        board: "border border-border bg-secondary text-secondary-foreground",
        /** 主色实底 badge-solid */
        solid: "bg-primary text-primary-foreground",
      },
      /** 主色圆点前缀 badge-dot */
      dot: {
        true: "",
        false: "",
      },
    },
    defaultVariants: {
      variant: "doc",
      dot: false,
    },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, dot }), className)} {...props}>
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />}
      {children}
    </span>
  );
}

export { badgeVariants };
