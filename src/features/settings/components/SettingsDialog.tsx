import { Bot, Check, Database, Info, Keyboard, Palette, Settings2, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AttachmentManager } from "@/features/attachments/components/AttachmentManager";
import { ShortcutsSettings } from "@/features/shortcuts/components/ShortcutsSettings";
import { LOCALE_LABELS, type Locale, useI18n } from "@/lib/i18n";
import { THEME_LABELS, THEME_NAMES, type ThemeMode, type ThemeName, useTheme } from "@/lib/theme";
import { CAPTION_CLS, cn } from "@/lib/utils";
import { AiSection } from "./AiSection";

type SettingsTab = "general" | "appearance" | "shortcuts" | "ai" | "storage" | "about";

const NAV: { id: SettingsTab; label: string; icon: typeof Info }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "ai", label: "AI 协作", icon: Bot },
  { id: "storage", label: "存储", icon: Database },
  { id: "about", label: "关于", icon: Info },
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前工作区根目录；空串表示未连接 */
  workspacePath: string;
}

/** 主题预览卡内的示意条 */
function ModeCard({ target, label }: { target: ThemeMode; label: string }) {
  const { mode, setMode } = useTheme();
  const active = mode === target;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setMode(target)}
      className={cn(
        "flex cursor-default items-center gap-3 rounded-[12px] border p-3 text-left transition-[background-color,border-color,box-shadow,translate,scale] duration-150 ease-[var(--ease)] hover:-translate-y-px active:scale-[0.99]",
        active ? "border-primary/35 bg-accent/45 shadow-sm" : "border-border/70 hover:bg-accent/30",
      )}
    >
      {/* mini 预览：底色 + 侧栏条 + 文字行 */}
      <span
        data-mode={target}
        data-theme="mist"
        className="relative h-12 w-20 shrink-0 overflow-hidden rounded-[7px] border border-border/60 bg-background"
      >
        <span className="absolute inset-y-0 left-0 w-4 bg-sidebar" />
        <span className="absolute top-2 left-6 h-1.5 w-10 rounded-full bg-foreground/60" />
        <span className="absolute top-5 left-6 h-1.5 w-12 rounded-full bg-muted-foreground/50" />
        <span className="absolute top-8 left-6 h-1.5 w-7 rounded-full bg-primary" />
      </span>
      <span className="flex-1 text-[13px] font-medium">{label}</span>
      {active && <Check className="size-4 text-primary" />}
    </button>
  );
}

function AppearanceSection() {
  const { theme, setTheme, mode } = useTheme();
  const { t } = useI18n();
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("外观")}</h3>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ModeCard target="light" label={t("浅色")} />
        <ModeCard target="dark" label={t("深色")} />
      </div>

      <h4 className="mt-6 text-[13px] font-semibold">{t("主题")}</h4>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {THEME_NAMES.map((themeName) => {
          const active = theme === themeName;
          return (
            <button
              key={themeName}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(themeName as ThemeName)}
              className={cn(
                "flex cursor-default flex-col gap-2 rounded-[12px] border p-2.5 text-left transition-[background-color,border-color,box-shadow,translate,scale] duration-150 ease-[var(--ease)] hover:-translate-y-px active:scale-[0.99]",
                active
                  ? "border-primary/40 bg-accent/40 shadow-sm ring-1 ring-primary/15"
                  : "border-border/70 hover:bg-accent/30",
              )}
            >
              {/* data-theme 作用于子树 → 预览点用该主题的 logo 变量 */}
              <span data-theme={themeName} data-mode={mode} className="flex items-center gap-1">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-a)" }} />
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-b)" }} />
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-c)" }} />
              </span>
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="truncate text-[12px] font-medium">{t(THEME_LABELS[themeName])}</span>
                {active && <Badge variant="solid">{t("使用中")}</Badge>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StorageSection({ workspacePath }: { workspacePath: string }) {
  const { t } = useI18n();
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("存储")}</h3>
      <div className="mt-4 rounded-md border border-border bg-muted/60 p-4">
        <p className="text-[12px] text-muted-foreground">{t("位置")}</p>
        <code className="mt-1 block break-all font-mono text-[12px]">
          {workspacePath || t("未连接工作区")}
        </code>
      </div>
      <AttachmentManager key={workspacePath} />
    </div>
  );
}

function GeneralSection() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("通用")}</h3>
      <div className="mt-4 max-w-[280px]">
        <label htmlFor="lang" className="mb-1.5 block text-[13px] font-medium">
          {t("界面语言")}
        </label>
        <Select value={locale} onValueChange={(value) => void setLocale(value as Locale)}>
          <SelectTrigger id="lang" aria-label={t("界面语言")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">{LOCALE_LABELS["zh-CN"]}</SelectItem>
            <SelectItem value="en-US">{LOCALE_LABELS["en-US"]}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function AboutSection() {
  const { t } = useI18n();
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("星屿")}</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>Starris · {t("本地工作区版")}</p>
      <dl className="mt-4 max-w-[320px]">
        {[
          [t("版本"), "0.1.0"],
          [t("设计系统"), t("v2.0 · 雾光笺")],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between border-b border-border/60 py-2 text-[13px] last:border-b-0"
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="mt-5 text-[13px] font-semibold">{t("第三方开源组件")}</h4>
      <ul className={`${CAPTION_CLS} mt-1 space-y-1 text-muted-foreground`}>
        <li>React Flow · MIT · https://github.com/xyflow/xyflow</li>
        <li>Excalidraw · MIT · https://github.com/excalidraw/excalidraw</li>
        <li>Tiptap · MIT · https://github.com/ueberdosis/tiptap</li>
      </ul>
    </div>
  );
}

/** 弹窗 C · 设置：720×480 模态，左导航 160px + 右内容区 */
export function SettingsDialog({ open, onOpenChange, workspacePath }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[540px] w-[760px] p-0" aria-describedby={undefined}>
        <div className="flex h-full min-h-0">
          {/* 左导航 */}
          <nav
            aria-label={t("设置")}
            className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border/60 bg-sidebar/55 p-2 text-sidebar-foreground"
          >
            <div className="flex items-center gap-2 px-2 py-2">
              <Settings2 className="size-4" />
              <DialogTitle className="text-[14px]">{t("设置")}</DialogTitle>
            </div>
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] transition-[background-color,color,transform] duration-150 ease-[var(--ease)] active:scale-[0.99]",
                  tab === id
                    ? "bg-accent/80 font-semibold text-accent-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-accent/35",
                )}
              >
                <Icon className="size-3.5" />
                {t(label)}
              </button>
            ))}
          </nav>

          {/* 右内容区 */}
          <ScrollArea className="flex-1 p-6">
            {tab === "general" && <GeneralSection />}
            {tab === "appearance" && <AppearanceSection />}
            {tab === "shortcuts" && <ShortcutsSettings />}
            {tab === "ai" && <AiSection />}
            {tab === "storage" && <StorageSection workspacePath={workspacePath} />}
            {tab === "about" && <AboutSection />}

            <div className="mt-6 flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                {t("完成")}
              </Button>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
