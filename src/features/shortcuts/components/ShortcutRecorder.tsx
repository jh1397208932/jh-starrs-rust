import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { bindingFromEvent } from "../shortcutKeys";

export interface ShortcutRecorderProps {
  /** 提交组合键；返回 false 表示校验失败，录制器保持打开。 */
  onCommit: (binding: string) => boolean;
  onCancel: () => void;
}

/**
 * 快捷键录制器：捕获阶段监听键盘，Esc 取消、Backspace 清空。
 * 仅按下修饰键不提交；录制期间阻止快捷键继续分发。
 */
export function ShortcutRecorder({ onCommit, onCancel }: ShortcutRecorderProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        onCommit("");
        return;
      }
      const binding = bindingFromEvent(event);
      if (!binding) return;
      event.preventDefault();
      event.stopPropagation();
      onCommit(binding);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [onCancel, onCommit]);

  return (
    <button
      type="button"
      ref={ref}
      aria-label={t("正在录制快捷键")}
      className="flex h-7 min-w-[148px] cursor-default items-center justify-center rounded-[7px] border border-dashed border-primary/60 bg-accent/40 px-2 text-[11.5px] text-accent-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t("请按组合键…")} <span className="ml-2 text-muted-foreground">{t("Esc 取消")}</span>
    </button>
  );
}
