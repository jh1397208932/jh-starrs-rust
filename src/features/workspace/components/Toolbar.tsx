import { Check, ChevronRight, List, PanelRight, Printer, Share, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CAPTION_CLS, cn } from "@/lib/utils";
import { MOCK_OUTLINE } from "@/mocks/workspace";

export interface ToolbarProps {
  kind: "doc" | "board" | "table" | "starred";
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
}

const iconBtn =
  "grid size-7 cursor-default place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * 36px 文档工具栏（顶栏两行制 · 文档层）：随标签页切换而变化。
 * 左：类型徽标 + 面包屑「知识库 / 文档名」（补齐所在位置上下文）；
 * 右：保存状态 · 收藏 · 目录(文档) · 信息面板 · 分享 · 打印。
 * 画板/表格不显示目录按钮；收藏列表为虚拟页，面包屑只有当前项。
 */
export function Toolbar({
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
}: ToolbarProps) {
  return (
    <div className="flex h-[var(--doctoolbar-h)] shrink-0 items-center gap-0.5 border-b border-border bg-background px-2.5">
      <Badge variant={kind === "doc" || kind === "starred" ? "doc" : "board"}>
        {kind === "board" ? "画板" : kind === "table" ? "表格" : kind === "starred" ? "收藏" : "文档"}
      </Badge>

      {/* 面包屑：所在知识库 / 当前文档 */}
      <nav aria-label="所在位置" className="flex min-w-0 items-center">
        {kbName && (
          <>
            <button
              type="button"
              onClick={onOpenKb}
              className="max-w-[180px] cursor-default truncate rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {kbName}
            </button>
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-sidebar-muted" />
          </>
        )}
        <span className="min-w-0 max-w-[260px] truncate px-1 text-[12.5px] font-medium text-foreground">
          {title}
        </span>
      </nav>

      <div className="flex-1" />

      <span
        className={cn(
          "mr-1 hidden shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground sm:flex",
          CAPTION_CLS,
        )}
      >
        <Check className="size-3.5 text-primary" />
        已自动保存
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
          <DropdownMenuContent align="end" className="w-[220px]">
            <DropdownMenuLabel>大纲</DropdownMenuLabel>
            {MOCK_OUTLINE.map((h) => (
              <DropdownMenuItem key={h.id} className={h.level === 2 ? "pl-6" : "font-medium"}>
                {h.text}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem className="text-muted-foreground">
              <ChevronRight />
              打开大纲面板
            </DropdownMenuItem>
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
  );
}
