import {
  Check,
  Download,
  Image,
  ListTree,
  Loader2,
  Network,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import type {
  MindmapBackground,
  MindmapBranchColoring,
  MindmapEdgeStyle,
  MindmapExportFormat,
  MindmapSaveStatus,
  MindmapStructure,
  MindmapTheme,
} from "@/types/mindmap";

interface MindmapPageBarProps {
  kbName: string | null;
  title: string;
  status: MindmapSaveStatus;
  structure: MindmapStructure;
  theme: MindmapTheme;
  coloring: MindmapBranchColoring;
  edgeStyle: MindmapEdgeStyle;
  background: MindmapBackground;
  showNumbers: boolean;
  outlineOpen: boolean;
  exporting: MindmapExportFormat | null;
  /** 失败态胶囊文案；加载失败与保存失败的语义不同 */
  errorText?: string;
  onOpenKb: () => void;
  onRetry: () => void;
  onReload: () => void;
  onSearch: () => void;
  onStructure: (value: MindmapStructure) => void;
  onTheme: (value: MindmapTheme) => void;
  onColoring: (value: MindmapBranchColoring) => void;
  onEdgeStyle: (value: MindmapEdgeStyle) => void;
  onBackground: (value: MindmapBackground) => void;
  onToggleNumbers: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetLayout: () => void;
  onToggleOutline: () => void;
  onExport: (value: MindmapExportFormat) => void;
}

function StatusPill({
  status,
  onRetry,
  onReload,
  errorText,
}: Pick<MindmapPageBarProps, "status" | "onRetry" | "onReload" | "errorText">) {
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
        className={`${base} text-destructive hover:bg-destructive/10 active:scale-[0.97]`}
      >
        <TriangleAlert className="size-3" aria-hidden="true" />
        {errorText ?? t("保存失败 · 重试")}
      </button>
    );
  }
  if (status === "conflict") {
    return (
      <button
        type="button"
        onClick={onReload}
        className={`${base} text-[var(--logo-c)] hover:bg-accent active:scale-[0.97]`}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {t("已更新 · 重新加载")}
      </button>
    );
  }
  return <span className={`${base} text-muted-foreground`}>{t("已保存")}</span>;
}

/** 思维导图页头：面包屑、结构/主题/分支配色/连线、导出与保存状态。 */
export function MindmapPageBar({
  kbName,
  title,
  status,
  structure,
  theme,
  coloring,
  edgeStyle,
  background,
  showNumbers,
  outlineOpen,
  exporting,
  errorText,
  onOpenKb,
  onRetry,
  onReload,
  onSearch,
  onStructure,
  onTheme,
  onColoring,
  onEdgeStyle,
  onBackground,
  onToggleNumbers,
  onExpandAll,
  onCollapseAll,
  onResetLayout,
  onToggleOutline,
  onExport,
}: MindmapPageBarProps) {
  const { t } = useI18n();
  const STRUCTURES: { id: MindmapStructure; label: string }[] = [
    { id: "balanced", label: "思维导图（左右）" },
    { id: "logic-right", label: "逻辑图（向右）" },
    { id: "logic-left", label: "逻辑图（向左）" },
    { id: "org-down", label: "组织结构（向下）" },
    { id: "org-up", label: "组织结构（向上）" },
    { id: "tree", label: "树状图" },
    { id: "timeline", label: "时间轴" },
    { id: "fishbone", label: "鱼骨图" },
  ];
  const THEMES: { id: MindmapTheme; label: string }[] = [
    { id: "vivid", label: "缤纷（默认）" },
    { id: "warm", label: "暖屿" },
    { id: "sea", label: "雾海" },
    { id: "mono", label: "墨线" },
    { id: "rose", label: "玫瑰" },
    { id: "forest", label: "森林" },
    { id: "sky", label: "天空" },
    { id: "plum", label: "李子" },
  ];
  return (
    <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
      <div className="flex min-w-0 items-center gap-1 text-[12.5px]">
        {kbName ? (
          <>
            <button
              type="button"
              onClick={onOpenKb}
              className="truncate rounded-[6px] px-1 py-0.5 text-muted-foreground transition-[background-color,color] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground"
            >
              {kbName}
            </button>
            <span className="text-muted-foreground/70">/</span>
          </>
        ) : null}
        <span className="truncate font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={outlineOpen ? "mindmap-toolbar-button is-active" : "mindmap-toolbar-button"}
          onClick={onToggleOutline}
          aria-label={t("大纲视图")}
          aria-pressed={outlineOpen}
        >
          <ListTree className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="mindmap-toolbar-button"
          onClick={onSearch}
          aria-label={t("搜索主题")}
        >
          <Search className="size-3.5" aria-hidden="true" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="mindmap-toolbar-button" aria-label={t("结构与主题")}>
              <Network className="size-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[86vh] w-[190px] overflow-y-auto">
            {STRUCTURES.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onStructure(item.id)}>
                <span className="flex-1">{t(item.label)}</span>
                {structure === item.id ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onColoring(coloring === "rainbow" ? "theme" : "rainbow")}>
              <span className="flex-1">{t("彩虹分支")}</span>
              {coloring === "rainbow" ? (
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onEdgeStyle(edgeStyle === "polyline" ? "curve" : "polyline")}>
              <span className="flex-1">{t("折线连线")}</span>
              {edgeStyle === "polyline" ? (
                <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {[
              { id: "dots" as MindmapBackground, label: "点阵背景" },
              { id: "grid" as MindmapBackground, label: "网格背景" },
              { id: "plain" as MindmapBackground, label: "纯色背景" },
            ].map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onBackground(item.id)}>
                <span className="flex-1">{t(item.label)}</span>
                {background === item.id ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleNumbers}>
              <span className="flex-1">{t("显示编号")}</span>
              {showNumbers ? <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onExpandAll}>
              <span className="flex-1">{t("全部展开")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCollapseAll}>
              <span className="flex-1">{t("全部折叠")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onResetLayout}>
              <span className="flex-1">{t("按结构重新排列")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {THEMES.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => onTheme(item.id)}>
                <span className="flex-1">{t(item.label)}</span>
                {theme === item.id ? (
                  <Check className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mindmap-toolbar-button"
              disabled={exporting !== null}
              aria-label={t("导出思维导图")}
            >
              {exporting ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[210px]">
            <DropdownMenuItem onSelect={() => onExport("xmind")}>{t("XMind 文件")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("freemind")}>{t("FreeMind 文件")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("opml")}>{t("OPML 大纲")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("markdown")}>{t("Markdown")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("native")}>{t("Starris 无损文件")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onExport("svg")}>
              <Image /> {t("SVG 矢量图")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onExport("png")}>
              <Image /> {t("PNG 图片")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <StatusPill status={status} onRetry={onRetry} onReload={onReload} errorText={errorText} />
      </div>
    </header>
  );
}
