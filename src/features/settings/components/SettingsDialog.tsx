import { Check, Cloud, Database, Info, Keyboard, Palette, Settings2, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { THEME_LABELS, THEME_NAMES, type ThemeMode, type ThemeName, useTheme } from "@/lib/theme";
import { CAPTION_CLS, cn } from "@/lib/utils";
import { SHORTCUTS } from "@/mocks/shortcuts";

type SettingsTab = "general" | "appearance" | "shortcuts" | "storage" | "cloud" | "about";

const NAV: { id: SettingsTab; label: string; icon: typeof Info }[] = [
  { id: "general", label: "通用", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "storage", label: "存储", icon: Database },
  { id: "cloud", label: "云同步", icon: Cloud },
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
        "flex cursor-default items-center gap-3 rounded-md border p-3 text-left transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "border-primary" : "border-border hover:bg-secondary",
      )}
    >
      {/* mini 预览：底色 + 侧栏条 + 文字行 */}
      <span
        data-mode={target}
        data-theme="sunset"
        className="relative h-12 w-20 shrink-0 overflow-hidden rounded-sm border border-border bg-background"
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
  return (
    <div>
      <h3 className="text-[14px] font-semibold">外观</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>选择明暗模式与主题预设，即时生效。</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ModeCard target="light" label="浅色" />
        <ModeCard target="dark" label="深色" />
      </div>

      <h4 className="mt-6 text-[13px] font-semibold">主题预设</h4>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {THEME_NAMES.map((t) => {
          const active = theme === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(t as ThemeName)}
              className={cn(
                "flex cursor-default flex-col gap-2 rounded-md border p-2.5 text-left transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active ? "border-primary" : "border-border hover:bg-secondary",
              )}
            >
              {/* data-theme 作用于子树 → 预览点用该主题的 logo 变量 */}
              <span data-theme={t} data-mode={mode} className="flex items-center gap-1">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-a)" }} />
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-b)" }} />
                <span className="size-3.5 rounded-full" style={{ backgroundColor: "var(--logo-c)" }} />
              </span>
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="truncate text-[12px] font-medium">{THEME_LABELS[t]}</span>
                {active && <Badge variant="solid">使用中</Badge>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutsSection() {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">快捷键</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>点击条目可开始录制（本阶段仅展示）。</p>
      <ul className="mt-3">
        {SHORTCUTS.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              className="flex h-9 w-full cursor-default items-center justify-between rounded-sm px-2 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <span className="text-[13px]">{s.label}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StorageSection({ workspacePath }: { workspacePath: string }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">存储</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>
        当前工作区的数据全部保存在你选择的本地文件夹。
      </p>
      <div className="mt-4 rounded-md border border-border bg-muted/60 p-4">
        <p className="text-[12px] text-muted-foreground">工作区根目录</p>
        <code className="mt-1 block break-all font-mono text-[12px]">{workspacePath || "未连接工作区"}</code>
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
          数据库：db/workspace.sqlite3；附件目录：storage/。附件容量统计将在附件功能上线后提供。
        </p>
      </div>
    </div>
  );
}

function GeneralSection() {
  const [lang, setLang] = useState("zh-CN");
  return (
    <div>
      <h3 className="text-[14px] font-semibold">通用</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>界面语言与基础行为。</p>
      <div className="mt-4 max-w-[280px]">
        <label htmlFor="lang" className="mb-1.5 block text-[13px] font-medium">
          界面语言
        </label>
        <Select value={lang} onValueChange={setLang}>
          <SelectTrigger id="lang">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">简体中文</SelectItem>
            <SelectItem value="en-US">English (US)</SelectItem>
            <SelectItem value="ja-JP">日本語</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className={`${CAPTION_CLS} mt-4 text-muted-foreground`}>
        启动时自动恢复上次工作区与外观设置；标签页会话尚未持久化。
      </p>
    </div>
  );
}

function CloudSection() {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">云同步</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>
        星屿云同步正在内测，当前版本所有数据保存在本地。
      </p>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-muted p-4">
        <Cloud className="size-5 text-muted-foreground" />
        <div>
          <p className="text-[13px] font-medium">尚未登录云账户</p>
          <p className="text-[12px] text-muted-foreground">登录后可跨设备同步工作空间</p>
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">关于星屿</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>Starris · 本地工作区版</p>
      <dl className="mt-4 max-w-[320px]">
        {[
          ["版本", "0.1.0"],
          ["引擎", "Tauri 2 + React 19"],
          ["设计系统", "v1.0 · sunset"],
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
    </div>
  );
}

/** 弹窗 C · 设置：720×480 模态，左导航 160px + 右内容区 */
export function SettingsDialog({ open, onOpenChange, workspacePath }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[480px] w-[720px] p-0" aria-describedby={undefined}>
        <div className="flex h-full min-h-0">
          {/* 左导航 */}
          <nav
            aria-label="设置"
            className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border bg-sidebar p-2 text-sidebar-foreground"
          >
            <div className="flex items-center gap-2 px-2 py-2">
              <Settings2 className="size-4" />
              <DialogTitle className="text-[14px]">设置</DialogTitle>
            </div>
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  tab === id
                    ? "bg-accent font-semibold text-accent-foreground"
                    : "text-sidebar-foreground hover:bg-secondary",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </nav>

          {/* 右内容区 */}
          <ScrollArea className="flex-1 p-6">
            {tab === "general" && <GeneralSection />}
            {tab === "appearance" && <AppearanceSection />}
            {tab === "shortcuts" && <ShortcutsSection />}
            {tab === "storage" && <StorageSection workspacePath={workspacePath} />}
            {tab === "cloud" && <CloudSection />}
            {tab === "about" && <AboutSection />}

            <div className="mt-6 flex justify-end">
              <Button size="sm" onClick={() => onOpenChange(false)}>
                完成
              </Button>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
