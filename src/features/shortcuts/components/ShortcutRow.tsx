import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/empty-state";
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
  const tokens = bindingTokens(binding);
  const changed = binding !== action.defaultBinding;
  return (
    <li className="rounded-[9px] px-2 py-1.5 transition-colors hover:bg-secondary/60">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[12.5px] text-foreground">{action.label}</span>
          {action.available === false && (
            <span className="shrink-0 text-[10px] text-muted-foreground">即将推出</span>
          )}
        </div>
        {recording ? (
          <ShortcutRecorder onCommit={onCommit} onCancel={onCancelRecord} />
        ) : (
          <button
            type="button"
            onClick={onStartRecord}
            aria-label={`录制 ${action.label}`}
            className={cn(
              "flex min-h-7 min-w-[148px] items-center justify-end gap-1 rounded-[7px] px-1.5 py-0.5 text-right transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              !binding && "text-muted-foreground",
            )}
          >
            {tokens.length > 0 ? (
              tokens.map((token) => <Kbd key={`${action.id}-${token}`}>{token}</Kbd>)
            ) : (
              <span className="text-[11.5px]">未设置</span>
            )}
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`恢复 ${action.label} 默认快捷键`}
          title="恢复默认"
          disabled={!changed}
          onClick={onReset}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      {(error || warning) && (
        <p className={cn("mt-1 text-right text-[11px]", error ? "text-destructive" : "text-amber-600")}>
          {error ?? warning}
        </p>
      )}
    </li>
  );
}
