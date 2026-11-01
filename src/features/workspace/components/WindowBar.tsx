import { Search, X } from "lucide-react";
import { motion } from "motion/react";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { bindingLabel } from "@/features/shortcuts/shortcutKeys";
import { useI18n } from "@/lib/i18n";
import { SPRING_PANEL } from "@/lib/motion";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { NODE_KIND_LABELS, type TabItem } from "@/types/notebook";
import { WindowControls } from "./WindowControls";

export interface WindowBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onSearch: () => void;
  /** 二分布局：侧栏折叠时（macOS）在本栏左侧回补红绿灯 Overlay 注入区 */
  trafficInset?: boolean;
  /** Tauri Window API 不可用（浏览器 dev）时的降级提示 */
  onWindowFallback: (label: string) => void;
}

/**
 * 44px 全局顶栏：只承载标签页、全局搜索与窗口控制。
 * 面包屑、保存态与文档操作（收藏/目录/信息/分享/打印）下沉到文档页头，
 * 避免同一组文档控件同时占据窗口 chrome 与正文两处。
 * 红绿灯在通高侧栏顶部（macOS）；侧栏折叠时经 trafficInset 在本栏回补注入区。
 * 窗口操作统一经 lib/window（AGENTS.md §3.3：组件禁止直接调用 @tauri-apps/api）。
 */
export function WindowBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onSearch,
  trafficInset = false,
  onWindowFallback,
}: WindowBarProps) {
  const { t } = useI18n();

  const iconBtn =
    "grid size-7 cursor-default place-items-center rounded-[9px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-card/60 hover:text-foreground";

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "window-bar relative z-10 flex h-[var(--winbar-h)] shrink-0 items-center gap-0.5 bg-transparent select-none",
        // Windows/Linux 的控制按钮贴齐右缘；macOS 保留 8px 呼吸位。
        IS_MAC ? "pr-2" : "pr-0",
      )}
    >
      {/* macOS 侧栏折叠时回补红绿灯 Overlay 注入区；常态由通高侧栏承载 */}
      {IS_MAC && trafficInset ? <TrafficLightSlot className="h-full" /> : null}

      {/* 标签页组：无边框药丸，激活态以 bg-background 顺接内容区 */}
      <div role="tablist" aria-label={t("标签页")} className="flex min-w-0 items-center gap-0.5 pl-2">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const kindLabel = tab.kind === "starred" ? t("收藏") : t(NODE_KIND_LABELS[tab.kind]);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              aria-label={`${kindLabel} · ${tab.title}`}
              tabIndex={-1}
              className={cn(
                "group relative flex h-[30px] min-w-0 items-center gap-1 rounded-[9px] px-2 transition-colors duration-150 ease-[var(--ease)]",
                !active && "hover:bg-card/40",
              )}
            >
              {/* 激活底片：layoutId 让药丸在标签之间滑动（弹簧），比底色瞬切更有连续性 */}
              {active && (
                <motion.span
                  layoutId="window-tab-pill"
                  aria-hidden="true"
                  transition={SPRING_PANEL}
                  className="absolute inset-0 rounded-[9px] bg-card/95 shadow-sm ring-1 ring-border/60 ring-inset"
                />
              )}
              <button
                type="button"
                title={tab.title}
                onClick={() => onSelect(tab.id)}
                className="relative flex min-w-0 cursor-default items-center gap-1.5 rounded-[8px]"
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
                aria-label={t("关闭标签页 {title}", { title: tab.title })}
                onClick={() => onClose(tab.id)}
                className={cn(
                  "relative grid size-[18px] shrink-0 cursor-default place-items-center rounded-[8px] transition-[opacity,background-color,scale] duration-150 ease-[var(--ease)] hover:scale-110 hover:bg-foreground/10 active:scale-95",
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

      {/* 弹性拖拽区 */}
      <div data-tauri-drag-region className="min-w-4 flex-1" />

      {/* 全局搜索：无边框胶囊（≥900px）⇄ 图标（<900px） */}
      <div className="ml-1 flex items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("全局搜索")}
              onClick={onSearch}
              className="hidden h-[30px] w-[236px] cursor-default items-center gap-2 rounded-full border border-border/60 bg-card/55 px-3 text-left shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-card/80 min-[900px]:flex"
            >
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-[12.5px] text-muted-foreground">{t("搜索…")}</span>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">
                {bindingLabel("Mod+Shift+F")}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("全局搜索")}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t("全局搜索")}
              onClick={onSearch}
              className={cn(iconBtn, "min-[900px]:hidden")}
            >
              <Search className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("全局搜索")}</TooltipContent>
        </Tooltip>
      </div>

      {/* 右侧：仅 Windows/Linux 自绘窗口控制（macOS 用系统红绿灯） */}
      {!IS_MAC && <WindowControls onWindowFallback={onWindowFallback} />}
    </header>
  );
}
