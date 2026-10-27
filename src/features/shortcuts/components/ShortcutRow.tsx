import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { bindingTokens } from "../shortcutKeys";
import type { ShortcutAction } from "../types";
import { ShortcutRecorder } from "./ShortcutRecorder";

export interface ShortcutRowProps {
  action: ShortcutAction;
  binding: string;
  recording: boolean;
  error: string | null;
  warning: string | null;
  onStartRecord: () => void;
  onCancelRecord: () => void;
  onCommit: (binding: string) => boolean;
  onReset: () => void;
}

/** 单个快捷键动作行：键帽、录制、恢复默认与校验提示。 */
export function ShortcutRow({
  action,
  binding,
  recording,
  error,
  warning,
  onStartRecord,
  onCancelRecord,
  onCommit,
  onReset,
}: ShortcutRowProps) {
  const { t } = useI18n();
  const tokens = bindingTokens(binding);
  const changed = binding !== action.defaultBinding;
  return (
    <li className="rounded-[9px] px-2 py-1.5 transition-colors hover:bg-secondary/60">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[12.5px] text-foreground">{t(action.label)}</span>
          {action.available === false && (
            <span className="shrink-0 text-[10px] text-muted-foreground">{t("即将推出")}</span>
          )}
        </div>
        {recording ? (
          <ShortcutRecorder onCommit={onCommit} onCancel={onCancelRecord} />
        ) : (
          <button
            type="button"
            onClick={onStartRecord}
            aria-label={t("录制 {label}", { label: t(action.label) })}
            className={cn(
              "flex min-h-7 min-w-[148px] items-center justify-end gap-1 rounded-[7px] px-1.5 py-0.5 text-right transition-colors hover:bg-accent/60",
              !binding && "text-muted-foreground",
            )}
          >
            {tokens.length > 0 ? (
              tokens.map((token) => <Kbd key={`${action.id}-${token}`}>{token}</Kbd>)
            ) : (
              <span className="text-[11.5px]">{t("未设置")}</span>
            )}
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("恢复 {label} 默认快捷键", { label: t(action.label) })}
          title={t("恢复默认")}
          disabled={!changed}
          onClick={onReset}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      {(error || warning) && (
        <p className={cn("mt-1 text-right text-[11px]", error ? "text-destructive" : "text-[var(--logo-c)]")}>
          {error ?? warning}
        </p>
      )}
    </li>
  );
}
