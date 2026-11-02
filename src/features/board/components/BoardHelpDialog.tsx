import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { BOARD_SHORTCUT_ACTIONS, BUILTIN_SHORTCUTS } from "@/features/shortcuts/actions";
import { useShortcutConfig } from "@/features/shortcuts/ShortcutProvider";
import { bindingLabel } from "@/features/shortcuts/shortcutKeys";
import { useI18n } from "@/lib/i18n";

export interface BoardHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TOOL_IDS = new Set(["board.select", "board.rectangle", "board.ellipse", "board.arrow", "board.text"]);
const BOARD_IDS = new Set(["board.openLibrary", "board.exportPng", "board.save"]);

/**
 * 画板帮助：只列本应用接管的动作，键位实时读快捷键配置；
 * 画布内置的固定键位单独一段，避免让用户误以为可以改。
 */
export function BoardHelpDialog({ open, onOpenChange }: BoardHelpDialogProps) {
  const { t } = useI18n();
  const { config } = useShortcutConfig();
  const bound = BOARD_SHORTCUT_ACTIONS.map((action) => ({
    ...action,
    binding: config.bindings[action.id] ?? "",
  }));
  const tools = bound.filter((action) => TOOL_IDS.has(action.id) && action.binding);
  const panels = bound.filter((action) => BOARD_IDS.has(action.id) && action.binding);
  const builtins = BUILTIN_SHORTCUTS.filter((item) => item.group === "画板内置");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[520px] max-w-[92vw] p-5" aria-describedby={undefined}>
        <DialogHeader
          title={t("帮助与快捷键")}
          description={t("键位与「设置 → 快捷键」一致；清空的动作不会出现在这里。")}
        />

        <div className="mt-4 max-h-[58vh] space-y-4 overflow-y-auto pr-1">
          {tools.length > 0 && (
            <section aria-label={t("工具")}>
              <h3 className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">{t("工具")}</h3>
              <ul className="overflow-hidden rounded-[10px] border border-border/60">
                {tools.map((action) => (
                  <ShortcutRow key={action.id} label={t(action.label)} binding={action.binding} />
                ))}
              </ul>
            </section>
          )}

          {panels.length > 0 && (
            <section aria-label={t("画板")}>
              <h3 className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">{t("画板")}</h3>
              <ul className="overflow-hidden rounded-[10px] border border-border/60">
                {panels.map((action) => (
                  <ShortcutRow key={action.id} label={t(action.label)} binding={action.binding} />
                ))}
              </ul>
            </section>
          )}

          <section aria-label={t("画布内置")}>
            <h3 className="mb-1.5 text-[11.5px] font-semibold text-muted-foreground">
              {t("画布内置")}
              <span className="ml-1.5 font-normal text-[10.5px]">{t("固定键位，不可修改")}</span>
            </h3>
            <ul className="overflow-hidden rounded-[10px] border border-border/60">
              {builtins.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 last:border-b-0"
                >
                  <span className="text-[12.5px] text-foreground">{t(item.label)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded-[5px] border border-border/70 bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t("关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutRow({ label, binding }: { label: string; binding: string }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 last:border-b-0">
      <span className="text-[12.5px] text-foreground">{label}</span>
      <kbd className="shrink-0 rounded-[5px] border border-border/70 bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
        {bindingLabel(binding)}
      </kbd>
    </li>
  );
}
