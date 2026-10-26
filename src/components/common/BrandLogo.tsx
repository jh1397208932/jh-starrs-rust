import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * 品牌标志：三个填色位引用 var(--logo-a/b/c)，随主题自动换色。
 * ≥16px 用完整三色 logo（DESIGN_TOKENS §5）。
 */
export function BrandLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label={t("星屿品牌标志")}
      role="img"
      className={cn("shrink-0", className)}
    >
      <circle cx="12" cy="13" r="3.2" fill="var(--logo-c)" />
      <path
        d="M33 9 L45 29 L21 29 Z"
        fill="var(--logo-c)"
        stroke="var(--logo-c)"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <rect
        x="11"
        y="31"
        width="30"
        height="22"
        rx="10.5"
        fill="var(--logo-a)"
        transform="rotate(-5 26 42)"
      />
      <rect x="38" y="36" width="15" height="14" rx="6.5" fill="var(--logo-b)" transform="rotate(6 45 43)" />
    </svg>
  );
}
