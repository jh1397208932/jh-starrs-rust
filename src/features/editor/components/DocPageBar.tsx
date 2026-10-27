import { ChevronRight, Download, History, List, PanelRight, Printer, Star } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { jumpToOutline, useEditorOutline } from "../editorOutline";

export interface DocPageBarProps {
  /** 当前文档标题（面包屑末级） */
  title: string;
  /** 所在知识库名；未知时为 null */
  kbName: string | null;
  /** 当前节点是否已收藏 */
  starred: boolean;
  /** 信息浮窗是否展开 */
  infoOpen: boolean;
  /** 切换收藏状态 */
  onToggleStar: () => void;
  /** 打开 / 收起信息浮窗 */
  onToggleInfo: () => void;
  /** 打开分享与导出弹窗 */
  onShare: () => void;
  /** 触发打印 */
  onPrint: () => void;
  /** 打开历史版本 */
  onHistory: () => void;
  /** 点击面包屑中的知识库 */
  onOpenKb: () => void;
}

const ICON_BTN =
  "grid size-7 cursor-default place-items-center rounded-[9px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground";

/**
 * 文档页头顶行：左侧面包屑（知识库 › 文档），右侧文档操作。
 * 这些控件从全局顶栏下沉，只随正文滚动，不占用窗口 chrome。
 */
export function DocPageBar({
  title,
  kbName,
  starred,
  infoOpen,
  onToggleStar,
  onToggleInfo,
  onShare,
  onPrint,
  onHistory,
  onOpenKb,
}: DocPageBarProps) {
  const { t } = useI18n();
  const { items: outline } = useEditorOutline();

  return (
    <div className="doc-page-bar mb-4 flex min-h-7 items-center justify-between gap-4">
      <nav aria-label={t("所在位置")} className="flex min-w-0 items-center">
        {kbName && (
          <>
            <button
              type="button"
              onClick={onOpenKb}
              className="max-w-[180px] cursor-default truncate rounded-[8px] px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-foreground"
            >
              {kbName}
            </button>
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground/60" />
          </>
        )}
        <span
          aria-current="page"
          className="min-w-0 max-w-[280px] truncate px-1 text-[12.5px] font-medium text-foreground"
        >
          {title}
        </span>
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={starred ? t("取消收藏 (⌘D)") : t("收藏 (⌘D)")}
              aria-pressed={starred}
              onClick={onToggleStar}
              className={cn(ICON_BTN)}
            >
              <Star className={cn("size-4", starred && "fill-primary text-primary")} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("收藏 (⌘D)")}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={t("文档目录")} className={cn(ICON_BTN)}>
              <List className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[240px]">
            <DropdownMenuLabel>{t("大纲")}</DropdownMenuLabel>
            {outline.length === 0 && (
              <DropdownMenuItem disabled className="text-muted-foreground">
                {t("暂无标题")}
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
                {heading.text || t("无标题")}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={infoOpen ? t("关闭信息面板") : t("打开信息面板")}
              aria-pressed={infoOpen}
              onClick={onToggleInfo}
              className={cn(ICON_BTN, infoOpen && "bg-accent text-accent-foreground")}
            >
              <PanelRight className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("信息面板")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={t("导出文档")} onClick={onShare} className={cn(ICON_BTN)}>
              <Download className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("导出文档")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={t("历史版本")} onClick={onHistory} className={cn(ICON_BTN)}>
              <History className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("历史版本")}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={t("打印")} onClick={onPrint} className={cn(ICON_BTN)}>
              <Printer className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("打印")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
