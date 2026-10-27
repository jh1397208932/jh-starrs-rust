import { Ban, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ColorOption } from "../constants";

export interface ColorSwatchesProps {
  colors: ColorOption[];
  mode: "text" | "highlight";
  activeValue?: string;
  onPick: (value: string) => void;
  onClear: () => void;
}

/** 色板：文字色显示“A”，高亮色显示实心圆；选中态用对勾与描边双提示。 */
export function ColorSwatches({ colors, mode, activeValue, onPick, onClear }: ColorSwatchesProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((color) => {
        const active = activeValue === color.value;
        return (
          <button
            key={color.value}
            type="button"
            title={t(color.label)}
            aria-label={t(color.label)}
            aria-pressed={active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(color.value)}
            className={cn(
              "relative grid size-7 place-items-center rounded-full border text-[13px] font-semibold transition-[box-shadow,transform] duration-150 ease-[var(--ease)] hover:scale-105",
              active
                ? "border-ring ring-2 ring-ring/35 ring-offset-1 ring-offset-popover"
                : "border-border hover:border-ring/50",
            )}
            style={
              mode === "highlight"
                ? { background: color.value }
                : { color: color.value, background: "var(--popover)" }
            }
          >
            {active ? (
              <Check
                className="size-3.5"
                strokeWidth={2.6}
                style={{ color: mode === "highlight" ? "var(--foreground)" : color.value }}
              />
            ) : mode === "text" ? (
              "A"
            ) : null}
          </button>
        );
      })}
      <button
        type="button"
        title={t("清除颜色")}
        aria-label={t("清除颜色")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
        className="grid size-7 place-items-center rounded-full border border-border text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      >
        <Ban className="size-3.5" />
      </button>
    </div>
  );
}
