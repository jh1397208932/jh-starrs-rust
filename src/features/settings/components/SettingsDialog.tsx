import {
  Bot,
  Check,
  Database,
  ExternalLink,
  Info,
  Keyboard,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { runAttachmentMaintenance } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { openExternalUrl } from "@/api/external";
import { getWorkspaceStorageStats, type WorkspaceStorageStats } from "@/api/storage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaintenancePolicyEditor } from "@/features/attachments/components/MaintenancePolicyEditor";
import { formatAttachmentBytes } from "@/features/attachments/utils/format";
import { ShortcutsSettings } from "@/features/shortcuts/components/ShortcutsSettings";
import { APP_ONE_LINER, CREDIT_GROUPS } from "@/lib/credits";
import { LOCALE_LABELS, type Locale, useI18n } from "@/lib/i18n";
import { EASE_STANDARD } from "@/lib/motion";
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

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * 设置 → 存储：只做统计与清理。
 *
 * 附件的上传、预览、下载与删除都在左侧文件树里完成（附件是树里的一等节点），
 * 这里不再重复一套管理界面。
 */
function StorageSection({ workspacePath }: { workspacePath: string }) {
  const { t } = useI18n();
  const [stats, setStats] = useState<WorkspaceStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [confirmClean, setConfirmClean] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await getWorkspaceStorageStats());
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setNotice(null);
    setConfirmClean(false);
    void load();
  }, [load]);

  const clean = async () => {
    if (!confirmClean) {
      setConfirmClean(true);
      setNotice(null);
      return;
    }
    setConfirmClean(false);
    setCleaning(true);
    setError(null);
    try {
      const result = await runAttachmentMaintenance();
      const cleaned = result.purged + result.expired + result.orphaned + result.orphanBlobs;
      setNotice(
        cleaned === 0 && result.stagedFiles === 0 && result.orphanFiles === 0
          ? t("没有需要清理的数据")
          : t("已清理 {count} 项临时或过期数据，释放约 {kb} KB", {
              count: cleaned + result.stagedFiles + result.orphanFiles,
              kb: Math.round(result.reclaimedBytes / 1024),
            }),
      );
      await load();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setCleaning(false);
    }
  };

  const size = (value: number | undefined) => formatAttachmentBytes(value ?? 0);

  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("存储")}</h3>
      <div className="mt-4 rounded-md border border-border bg-muted/60 p-4">
        <p className="text-[12px] text-muted-foreground">{t("位置")}</p>
        <code className="mt-1 block break-all font-mono text-[12px]">
          {workspacePath || t("未连接工作区")}
        </code>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-semibold">{t("占用统计")}</h4>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("刷新存储统计")}
          title={t("刷新")}
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <StatCell label={t("工作区总大小")} value={size(stats?.totalBytes)} />
        <StatCell label={t("数据库")} value={size(stats?.databaseBytes)} />
        <StatCell label={t("附件总大小")} value={size(stats?.attachmentBytes)} />
        <StatCell label={t("回收站")} value={size(stats?.trashBytes)} />
        <StatCell label={t("临时文件")} value={size(stats?.tempBytes)} />
        <StatCell label={t("隔离区")} value={size(stats?.quarantineBytes)} />
      </div>
      <p className={cn(CAPTION_CLS, "mt-2 text-muted-foreground")}>
        {t("可回收")} {size(stats?.reclaimableBytes)}
        {stats?.diskFreeBytes !== null && stats?.diskFreeBytes !== undefined
          ? t(" · 剩余空间 {size}", { size: formatAttachmentBytes(stats.diskFreeBytes) })
          : ""}
        {stats?.lastMaintenanceAt
          ? t(" · 最近维护 {time}", { time: new Date(stats.lastMaintenanceAt).toLocaleString() })
          : t(" · 尚未执行维护")}
      </p>

      <div className="mt-4 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h5 className="text-[12.5px] font-semibold">{t("立即清理")}</h5>
          <Button
            size="sm"
            variant={confirmClean ? "destructive" : "outline"}
            disabled={cleaning || loading}
            onClick={() => void clean()}
          >
            {cleaning ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {cleaning ? t("清理中…") : confirmClean ? t("确认清理？") : t("开始清理")}
          </Button>
        </div>
        <p className={cn(CAPTION_CLS, "mt-1.5 leading-relaxed text-muted-foreground")}>
          {t("只清理临时数据和过期数据；正在使用的文档、画板、思维导图与附件不会删除。")}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[12px] text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={cn(CAPTION_CLS, "mt-2 text-primary")}>
          {notice}
        </p>
      )}

      <MaintenancePolicyEditor />
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
            <SelectValue label={LOCALE_LABELS[locale]} />
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
  const [ossOpen, setOssOpen] = useState(false);
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("星屿")}</h3>
      <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>Starris · {t("本地工作区版")}</p>
      <p className="mt-2 text-[13px] leading-relaxed">{t(APP_ONE_LINER)}</p>
      <dl className="mt-4 max-w-[360px]">
        {[
          [t("版本"), "0.1.0"],
          [t("设计系统"), t("v2.0 · 雾光笺")],
          [t("运行方式"), t("本地桌面应用")],
          [t("数据位置"), t("保存在本地工作区")],
        ].map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-border/60 py-2 text-[13px] last:border-b-0"
          >
            <dt className="shrink-0 text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words text-right font-mono text-[12px]">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 rounded-[10px] border border-border/60 bg-muted/25 px-3.5 py-3">
        <p className="text-[12.5px] leading-relaxed text-foreground">
          {t("星屿建立在这些开源项目之上，感谢每一位作者与贡献者。")}
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setOssOpen(true)}>
          {t("查看开源项目清单")}
        </Button>
      </div>

      <Dialog open={ossOpen} onOpenChange={setOssOpen}>
        <DialogContent className="w-[560px] max-w-[92vw] p-5" aria-describedby={undefined}>
          <DialogTitle>{t("开源项目")}</DialogTitle>
          <p className="mt-1 text-[12px] text-muted-foreground">{t("星屿直接使用的开源项目。")}</p>
          <ScrollArea className="mt-3 max-h-[52vh] pr-1">
            {CREDIT_GROUPS.map((group) => (
              <section key={group.id} className="mb-3 last:mb-0">
                <h5 className="text-[11.5px] font-semibold text-muted-foreground">{t(group.title)}</h5>
                <ul className="mt-1">
                  {group.items.map((item) => (
                    <li key={item.name} className="border-b border-border/50 last:border-b-0">
                      <button
                        type="button"
                        title={item.url}
                        onClick={() => void openExternalUrl(item.url)}
                        className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-foreground">
                            {item.name}
                          </span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">
                            {item.license} · {item.url.replace(/^https?:\/\//, "")}
                          </span>
                        </span>
                        <ExternalLink
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="mt-2 text-[11.5px] text-muted-foreground">{t("以及这些项目的上游项目。")}</p>
          </ScrollArea>
        </DialogContent>
      </Dialog>
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
            {/* 分区切换：旧内容先 80ms 淡出再换新内容，避免整页“瞬切”的 Web 感 */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2, transition: { duration: 0.08, ease: EASE_STANDARD } }}
                transition={{ duration: 0.14, ease: EASE_STANDARD }}
              >
                {tab === "general" && <GeneralSection />}
                {tab === "appearance" && <AppearanceSection />}
                {tab === "shortcuts" && <ShortcutsSettings />}
                {tab === "ai" && <AiSection />}
                {tab === "storage" && <StorageSection key={workspacePath} workspacePath={workspacePath} />}
                {tab === "about" && <AboutSection />}
              </motion.div>
            </AnimatePresence>

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
