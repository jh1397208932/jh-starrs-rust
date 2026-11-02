import {
  ChevronRight,
  CircleHelp,
  Download,
  FileCode2,
  FileJson,
  FolderOpen,
  Image,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BoardExportFormat, BoardSaveStatus } from "@/types/board";

/** 与 Excalidraw 原生画布背景选题一致；「重置」也回到第一项。 */
const BACKGROUNDS = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"] as const;

const ACTION_BTN =
  "inline-flex h-[26px] items-center gap-1 rounded-[7px] px-2 text-[11.5px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";

interface BoardPageBarProps {
  /** 知识库名；为空时不显示首段面包屑 */
  kbName: string | null;
  /** 画板标题 */
  title: string;
  /** 当前保存状态 */
  status: BoardSaveStatus;
  /** 失败重试 */
  onRetry: () => void;
  /** 版本冲突后重新加载 */
  onReload: () => void;
  /** 点击面包屑中的知识库 */
  onOpenKb: () => void;
  /** 导出当前画板 */
  onExport: (format: BoardExportFormat) => void;
  /** 进入/退出放映 */
  onPresent: () => void;
  /** 当前画布背景色 */
  background: string;
  /** 修改画布背景 */
  onBackgroundChange: (color: string) => void;
  /** 打开帮助与快捷键 */
  onOpenHelp: () => void;
  /** 重置画布（调用方负责二次确认） */
  onResetCanvas: () => void;
  /** 打开本地 .excalidraw 文件 */
  onOpenFile: () => void;
  /** 打开画布内查找 */
  onFindInCanvas: () => void;
  /** 正在导出的格式 */
  exporting?: BoardExportFormat | null;
}

/** 状态文案与图标；保存胶囊与文档页头保持同一语义。 */
function StatusPill({
  status,
  onRetry,
  onReload,
}: Pick<BoardPageBarProps, "status" | "onRetry" | "onReload">) {
  const { t } = useI18n();
  const base =
    "inline-flex h-[22px] items-center gap-1 rounded-full border border-border/50 bg-card/45 px-2 text-[11.5px] whitespace-nowrap transition-[background-color,color,scale] duration-150 ease-[var(--ease)]";
  if (status === "loading") {
    return (
      <span className={`${base} text-muted-foreground`}>
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {t("加载中")}
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className={`${base} text-primary`}>
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {t("保存中")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={`${base} text-destructive hover:bg-destructive/10`}
        aria-label={t("保存失败，点击重试")}
      >
        <TriangleAlert className="size-3" aria-hidden="true" />
        {t("保存失败 · 重试")}
      </button>
    );
  }
  if (status === "conflict") {
    return (
      <button
        type="button"
        onClick={onReload}
        className={`${base} text-[var(--logo-c)] hover:bg-accent`}
        aria-label={t("已在别处更新，点击重新加载")}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {t("已更新 · 重新加载")}
      </button>
    );
  }
  return <span className={`${base} text-muted-foreground`}>{t("已保存")}</span>;
}

export function BoardPageBar({
  kbName,
  title,
  status,
  onRetry,
  onReload,
  onOpenKb,
  onExport,
  onPresent,
  background,
  onBackgroundChange,
  onOpenHelp,
  onResetCanvas,
  onOpenFile,
  onFindInCanvas,
  exporting = null,
}: BoardPageBarProps) {
  const { t } = useI18n();
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
      <div className="flex min-w-0 items-center gap-1 text-[12.5px]">
        {kbName ? (
          <>
            <button
              type="button"
              onClick={onOpenKb}
              className="truncate rounded-[6px] px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {kbName}
            </button>
            <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          </>
        ) : null}
        <span className="truncate font-medium text-foreground">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onPresent} className={ACTION_BTN} aria-label={t("放映画板")}>
          <Play className="size-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">{t("放映")}</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={exporting !== null}
              className={ACTION_BTN}
              aria-label={t("导出画板")}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{t("导出")}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-[210px]">
            <DropdownMenuItem onSelect={() => onExport("png")}>
              <Image />
              {t("PNG 图片")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("svg")}>
              <FileCode2 />
              {t("SVG 矢量图")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("excalidraw")}>
              <FileJson />
              {t("Excalidraw 文件")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid size-[26px] place-items-center rounded-[7px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground active:scale-[0.94]"
              aria-label={t("画板更多操作")}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-[248px]">
            <DropdownMenuItem onSelect={onOpenHelp}>
              <CircleHelp />
              {t("帮助与快捷键")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("画布背景")}</DropdownMenuLabel>
            <fieldset aria-label={t("画布背景")} className="m-0 flex items-center gap-1.5 border-0 px-2 pb-2">
              {BACKGROUNDS.map((color, index) => (
                <button
                  key={color}
                  type="button"
                  aria-label={t("画布背景 {index}", { index: index + 1 })}
                  aria-pressed={background.toLowerCase() === color}
                  onClick={() => onBackgroundChange(color)}
                  className={cn(
                    "size-5 rounded-[6px] border transition-[border-color,scale] duration-150 ease-[var(--ease)] hover:scale-110",
                    background.toLowerCase() === color
                      ? "border-primary ring-1 ring-primary/40"
                      : "border-border/70",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </fieldset>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenFile}>
              <FolderOpen />
              {t("打开画板文件…")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onFindInCanvas}>
              <Search />
              {t("画布内查找")}
              <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">⌘F</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onResetCanvas}
              className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
            >
              <RotateCcw />
              {t("重置画布")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <StatusPill status={status} onRetry={onRetry} onReload={onReload} />
      </div>
    </header>
  );
}
