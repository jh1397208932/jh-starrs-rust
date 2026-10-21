import { Minus, Plus, Search, Settings, Square, X } from "lucide-react";
import { NODE_KIND_LABELS, NodeKindIcon } from "@/components/common/NodeKindIcon";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import { Kbd } from "@/components/ui/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { runWindowAction, windowActions } from "@/lib/window";
import type { TabItem } from "@/types/notebook";

export interface WindowBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onOpenSettings: () => void;
  /** 二分布局：侧栏折叠时（macOS）在本栏左侧回补红绿灯 Overlay 注入区 */
  trafficInset?: boolean;
  /** Tauri Window API 不可用（浏览器 dev）时的降级提示 */
  onWindowFallback: (label: string) => void;
}

/** macOS 用系统红绿灯（Overlay 注入），Windows/Linux 用右侧自绘控制 */
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/**
 * 44px 窗口栏（二分布局 · 右列顶部 · 窗口层）：bg-sidebar + drag-region。
 * tab 区域从侧栏分割线起：左：标签页组（激活态与内容区同色顺接：bg-background 盖过分隔线）；
 * 右：全局搜索胶囊（<900px 收缩为图标）+ 设置 +（仅 Windows）自绘最小化/最大化/关闭。
 * 红绿灯在通高侧栏顶部（macOS）；侧栏折叠时经 trafficInset 在本栏回补注入区。
 * 与文档相关的上下文/操作在下方 Toolbar（文档层）—— 切标签只有文档层变化。
 * 亮暗切换不在此处 —— 统一走「设置 → 外观」。
 * 窗口操作统一经 lib/window（AGENTS.md §3.3：组件禁止直接调用 @tauri-apps/api）。
 */
export function WindowBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
  onSearch,
  onOpenSettings,
  trafficInset = false,
  onWindowFallback,
}: WindowBarProps) {
  const minimize = () => runWindowAction(windowActions.minimize, "最小化窗口", onWindowFallback);
  const toggleMaximize = () =>
    runWindowAction(windowActions.toggleMaximize, "最大化 / 还原窗口", onWindowFallback);
  const close = () => runWindowAction(windowActions.close, "关闭窗口", onWindowFallback);

  const controlBtn =
    "grid size-7 cursor-default place-items-center rounded-md text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-secondary";

  return (
    <header
      data-tauri-drag-region
      className="relative z-10 flex h-[var(--winbar-h)] shrink-0 items-stretch border-b border-border bg-sidebar pr-2 select-none"
    >
      {/* macOS 侧栏折叠时回补红绿灯 Overlay 注入区；常态由通高侧栏承载 */}
      {isMac && trafficInset ? <TrafficLightSlot className="h-full" /> : null}

      {/* 标签页组：从分割线起，底对齐；激活 tab 通过 -mb-px + bg-background 盖住本行分隔线 */}
      <div role="tablist" aria-label="标签页" className="flex min-w-0 items-end self-end gap-0.5 pl-2">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={`${NODE_KIND_LABELS[tab.kind]} · ${tab.title}`}
              tabIndex={-1}
              className={cn(
                "group -mb-px flex h-[34px] min-w-0 items-center gap-1 rounded-t-[10px] border border-b-0 px-2 transition-colors duration-150 ease-[var(--ease)]",
                active
                  ? "border-border bg-background shadow-[0_1px_0_0_var(--background)]"
                  : "border-transparent hover:bg-foreground/5",
              )}
            >
              <button
                type="button"
                title={tab.title}
                onClick={() => onSelect(tab.id)}
                className="flex min-w-0 cursor-default items-center gap-1.5 rounded-[4px] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
              >
                <NodeKindIcon
                  kind={tab.kind}
                  className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/70")}
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
                  "grid size-[18px] shrink-0 cursor-default place-items-center rounded-[4px] transition-opacity duration-150 ease-[var(--ease)] hover:bg-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
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
        <button
          type="button"
          aria-label="新建标签页 (⌘N)"
          onClick={onNew}
          className="grid h-[34px] w-7 shrink-0 cursor-default place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {/* 弹性拖拽区 */}
      <div data-tauri-drag-region className="min-w-6 flex-1" />

      {/* 全局搜索：胶囊（≥900px）⇄ 图标（<900px） */}
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="全局搜索 (⌘⇧F)"
              onClick={onSearch}
              className="hidden h-[30px] w-[240px] cursor-default items-center gap-2 rounded-[9px] border border-border bg-secondary px-2.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[900px]:flex"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[12.5px] text-muted-foreground">搜索或跳转…</span>
              <Kbd>⌘K</Kbd>
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
              className={cn(
                "grid size-7 cursor-default place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[900px]:hidden",
              )}
            >
              <Search className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>全局搜索 (⌘⇧F)</TooltipContent>
        </Tooltip>
      </div>

      {/* 右侧：设置 +（仅 Windows）窗口控制 */}
      <div className="flex items-center">
        <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-border" />
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
            <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-border" />
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
                    "grid size-7 cursor-default place-items-center rounded-md text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-destructive hover:text-destructive-foreground",
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
