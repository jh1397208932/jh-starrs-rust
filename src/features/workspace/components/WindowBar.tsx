import {
  Check,
  ChevronRight,
  List,
  Minus,
  PanelRight,
  Printer,
  Search,
  Settings,
  Share,
  Square,
  Star,
  X,
} from "lucide-react";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { jumpToOutline, useEditorOutline } from "@/features/editor/editorOutline";
import { CAPTION_CLS, cn } from "@/lib/utils";
import { runWindowAction, windowActions } from "@/lib/window";
import { NODE_KIND_LABELS, type OpenableKind, type TabItem } from "@/types/notebook";

export interface WindowBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  /** 文档层上下文（原第二行 Toolbar 并入）：随激活标签变化 */
  kind: OpenableKind | "starred";
  title: string;
  /** 面包屑上级（文档所在知识库名）；收藏列表等虚拟页 / 无所属时传 null */
  kbName: string | null;
  starred: boolean;
  infoOpen: boolean;
  onToggleStar: () => void;
  onToggleInfo: () => void;
  onShare: () => void;
  onPrint: () => void;
  /** 点击面包屑中的知识库（mock 阶段弹 toast） */
  onOpenKb: () => void;
  /** 二分布局：侧栏折叠时（macOS）在本栏左侧回补红绿灯 Overlay 注入区 */
  trafficInset?: boolean;
  /** Tauri Window API 不可用（浏览器 dev）时的降级提示 */
  onWindowFallback: (label: string) => void;
}

/** macOS 用系统红绿灯（Overlay 注入），Windows/Linux 用右侧自绘控制 */
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/**
 * 44px 单行制顶栏（窗口层 + 文档层合一）：bg-sidebar + drag-region，以色块分界不画线。
 * 左：标签页组（无边框药丸，激活 = bg-background）+ 所在位置面包屑（知识库 › 文档）；
 * 右：保存状态 · 收藏 · 目录(文档) · 信息面板(文档) · 分享 · 打印 · 搜索胶囊 · 设置 +（仅 Windows）自绘窗控。
 * 分界完全依靠 sidebar / background 色差：本栏无 border-b，侧栏无 border-r，激活 tab 无描边——参考 wolai「以色代线」。
 * 红绿灯在通高侧栏顶部（macOS）；侧栏折叠时经 trafficInset 在本栏回补注入区。
 * 窗口操作统一经 lib/window（AGENTS.md §3.3：组件禁止直接调用 @tauri-apps/api）。
 */
export function WindowBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onSearch,
  onOpenSettings,
  kind,
  title,
  kbName,
  starred,
  infoOpen,
  onToggleStar,
  onToggleInfo,
  onShare,
  onPrint,
  onOpenKb,
  trafficInset = false,
  onWindowFallback,
}: WindowBarProps) {
  const { items: outline } = useEditorOutline();
  const minimize = () => runWindowAction(windowActions.minimize, "最小化窗口", onWindowFallback);
  const toggleMaximize = () =>
    runWindowAction(windowActions.toggleMaximize, "最大化 / 还原窗口", onWindowFallback);
  const close = () => runWindowAction(windowActions.close, "关闭窗口", onWindowFallback);

  const iconBtn =
    "grid size-7 cursor-default place-items-center rounded-[9px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-card/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  const controlBtn =
    "grid size-7 cursor-default place-items-center rounded-[9px] text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-card/60";

  return (
    <header
      data-tauri-drag-region
      className="relative z-10 flex h-[var(--winbar-h)] shrink-0 items-center gap-0.5 bg-transparent pr-2 select-none"
    >
      {/* macOS 侧栏折叠时回补红绿灯 Overlay 注入区；常态由通高侧栏承载 */}
      {isMac && trafficInset ? <TrafficLightSlot className="h-full" /> : null}

      {/* 标签页组：无边框药丸，激活态以 bg-background 顺接内容区 */}
      <div role="tablist" aria-label="标签页" className="flex min-w-0 items-center gap-0.5 pl-2">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const kindLabel = tab.kind === "starred" ? "收藏" : NODE_KIND_LABELS[tab.kind];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={`${kindLabel} · ${tab.title}`}
              tabIndex={-1}
              className={cn(
                "group flex h-[30px] min-w-0 items-center gap-1 rounded-[9px] px-2 transition-[background-color,box-shadow] duration-150 ease-[var(--ease)]",
                active
                  ? "bg-card/80 shadow-sm ring-1 ring-border/60 ring-inset backdrop-blur-md"
                  : "hover:bg-card/40",
              )}
            >
              <button
                type="button"
                title={tab.title}
                onClick={() => onSelect(tab.id)}
                className="flex min-w-0 cursor-default items-center gap-1.5 rounded-[8px] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
              >
                <NodeKindIcon
                  kind={tab.kind}
                  className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/60")}
                />
                <span
                  className={cn(
                    "min-w-0 max-w-[160px] truncate text-[13px]",
                    active ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {tab.title}
                </span>
              </button>
              <button
                type="button"
                aria-label={`关闭标签页 ${tab.title}`}
                onClick={() => onClose(tab.id)}
                className={cn(
                  "grid size-[18px] shrink-0 cursor-default place-items-center rounded-[8px] transition-opacity duration-150 ease-[var(--ease)] hover:bg-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
                  active
                    ? "opacity-50 hover:opacity-100"
                    : "opacity-0 group-hover:opacity-60 group-hover:hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* 所在位置：知识库 › 文档（纯文字面包屑，随激活标签变化） */}
      {title && (
        <nav aria-label="所在位置" className="ml-1 flex min-w-0 items-center">
          {kbName && (
            <>
              <button
                type="button"
                onClick={onOpenKb}
                className="max-w-[160px] cursor-default truncate rounded-[9px] px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-card/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {kbName}
              </button>
              <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-sidebar-muted" />
            </>
          )}
          <span className="min-w-0 max-w-[240px] truncate px-1 text-[12.5px] font-medium text-foreground">
            {title}
          </span>
        </nav>
      )}

      {/* 弹性拖拽区 */}
      <div data-tauri-drag-region className="min-w-4 flex-1" />

      {/* 保存状态 + 文档操作 */}
      <div className="flex shrink-0 items-center gap-0.5">
        <span
          title="本地自动保存"
          className={cn(
            "mr-1 hidden h-[24px] shrink-0 items-center gap-1 rounded-full border border-border/50 bg-card/45 px-2 whitespace-nowrap text-muted-foreground backdrop-blur-sm sm:flex",
            CAPTION_CLS,
          )}
        >
          <Check className="size-3 text-primary" />
          已保存
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={starred ? "取消收藏 (⌘D)" : "收藏 (⌘D)"}
              aria-pressed={starred}
              onClick={onToggleStar}
              className={cn(iconBtn)}
            >
              <Star className={cn("size-4", starred && "fill-primary text-primary")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>收藏 (⌘D)</TooltipContent>
        </Tooltip>

        {/* 目录（大纲面板弹窗，仅文档视图） */}
        {kind === "doc" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="文档目录" className={cn(iconBtn)}>
                <List className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px]">
              <DropdownMenuLabel>大纲</DropdownMenuLabel>
              {outline.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  暂无标题
                </DropdownMenuItem>
              )}
              {outline.map((heading) => (
                <DropdownMenuItem
                  key={`${heading.id}-${heading.pos}`}
                  onSelect={() => jumpToOutline(heading.pos)}
                  className={cn(
                    "truncate",
                    heading.level === 1 && "font-medium",
                    heading.level === 2 && "pl-6",
                    heading.level >= 3 && "pl-9 text-muted-foreground",
                  )}
                >
                  {heading.text || "无标题"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 信息面板（与目录一样为文档独有：画板/表格/收藏不显示） */}
        {kind === "doc" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={infoOpen ? "关闭信息面板" : "打开信息面板"}
                aria-pressed={infoOpen}
                onClick={onToggleInfo}
                className={cn(
                  iconBtn,
                  infoOpen && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <PanelRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>信息面板</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="分享与导出" onClick={onShare} className={cn(iconBtn)}>
              <Share className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>分享与导出</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="打印" onClick={onPrint} className={cn(iconBtn)}>
              <Printer className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>打印</TooltipContent>
        </Tooltip>
      </div>

      {/* 全局搜索：无边框胶囊（≥900px）⇄ 图标（<900px） */}
      <div className="ml-1 flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="全局搜索 (⌘⇧F)"
              onClick={onSearch}
              className="hidden h-[30px] w-[236px] cursor-default items-center gap-2 rounded-full border border-border/60 bg-card/55 px-3 text-left shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-card/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[900px]:flex"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[12.5px] text-muted-foreground">搜索或跳转…</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">⌘K</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>全局搜索 (⌘⇧F)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="全局搜索 (⌘⇧F)"
              onClick={onSearch}
              className={cn(iconBtn, "min-[900px]:hidden")}
            >
              <Search className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>全局搜索 (⌘⇧F)</TooltipContent>
        </Tooltip>
      </div>

      {/* 右侧：设置 +（仅 Windows）窗口控制 */}
      <div className="ml-0.5 flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="设置 (⌘,)" onClick={onOpenSettings} className={cn(controlBtn)}>
              <Settings className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>设置 (⌘,)</TooltipContent>
        </Tooltip>

        {!isMac && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="最小化" onClick={minimize} className={cn(controlBtn)}>
                  <Minus className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>最小化</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="最大化 / 还原"
                  onClick={toggleMaximize}
                  className={cn(controlBtn)}
                >
                  <Square className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>最大化 / 还原</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={close}
                  className={cn(
                    "grid size-7 cursor-default place-items-center rounded-[9px] text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-destructive hover:text-destructive-foreground",
                  )}
                >
                  <X className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>关闭</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  );
}
