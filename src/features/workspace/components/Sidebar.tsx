import { ChevronDown, ChevronRight, Ellipsis, Folder, Plus, Star, StickyNote } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import { Kbd } from "@/components/ui/empty-state";
import { TRANSITION_COLLAPSE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { KnowledgeBase, NodeItem, TreeEntry, Workspace } from "@/types/notebook";
import { MoreMenu } from "./MoreMenu";
import { WorkspaceSwitchPopover } from "./WorkspaceSwitchPopover";

export interface SidebarProps {
  workspaces: Workspace[];
  kbs: KnowledgeBase[];
  tree: TreeEntry[];
  moreMenuOpen: boolean;
  onMoreMenuOpenChange: (open: boolean) => void;
  onSwitchWorkspace: (id: string) => void;
  onSwitchKb: (id: string) => void;
  onCreateWorkspace: () => void;
  onCreateKb: () => void;
  onManageKbs: () => void;
  onManageWorkspaces: () => void;
  onOpenSettings: () => void;
  onMockAction: (label: string) => void;
  onShowStarred: () => void;
  onCreateNote: () => void;
  onCreateDoc: () => void;
  onOpenNode: (node: NodeItem) => void;
}

const QUICK_ACTIONS = [
  { id: "starred", icon: Star, label: "收藏" },
  { id: "note", icon: StickyNote, label: "小记" },
  { id: "new", icon: Plus, label: "新建" },
] as const;

/**
 * 232px 通高左侧列（二分布局 · 左）：窗口拖拽带（macOS 承载红绿灯 Overlay）
 * → logo/空间名（点击开弹窗 A）→ 三快捷钮 → 文件夹树 → 底部更多(⌘J)。
 * 全部使用 --sidebar-* 令牌组；选中 = bg-sidebar-active + text-sidebar-active-fg。
 */

export function Sidebar(props: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["folder-1"]));
  const [selectedId, setSelectedId] = useState<string | null>("node-1");
  const currentWorkspace = props.workspaces.find((ws) => ws.isCurrent) ?? props.workspaces[0];

  const toggleFolder = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1);
      rows[next]?.focus();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const row = rows[index];
      const folderId = row?.dataset.folderId;
      if (!folderId) return;
      e.preventDefault();
      if (e.key === "ArrowRight") setExpanded((prev) => new Set(prev).add(folderId));
      else toggleFolder(folderId);
    }
  };

  const renderNode = (node: NodeItem) => {
    const selected = selectedId === node.id;
    return (
      <button
        key={node.id}
        type="button"
        data-tree-row
        role="treeitem"
        aria-selected={selected}
        onClick={() => {
          setSelectedId(node.id);
          props.onOpenNode(node);
        }}
        className={cn(
          "flex h-8 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-[13px] transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          selected
            ? "bg-sidebar-active font-semibold text-sidebar-active-fg"
            : "text-sidebar-foreground hover:bg-secondary",
        )}
        style={{ paddingLeft: 32 }}
      >
        <NodeKindIcon kind={node.kind} className="size-4 shrink-0" />
        <span className="truncate">{node.title}</span>
      </button>
    );
  };

  const renderEntry = (entry: TreeEntry) => {
    if (entry.kind !== "folder") return renderNode(entry);
    const isExpanded = expanded.has(entry.id);
    const Chevron = isExpanded ? ChevronDown : ChevronRight;
    return (
      <div key={entry.id}>
        <button
          type="button"
          data-tree-row
          data-folder-id={entry.id}
          role="treeitem"
          aria-expanded={isExpanded}
          onClick={() => toggleFolder(entry.id)}
          className="flex h-8 w-full cursor-default items-center gap-1.5 rounded-sm px-2 text-left text-[13px] text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <Chevron className="size-3.5 shrink-0 text-sidebar-muted" />
          <Folder className="size-4 shrink-0 text-sidebar-muted" />
          <span className="truncate font-medium">{entry.title}</span>
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="children"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={TRANSITION_COLLAPSE}
              className="overflow-hidden"
            >
              {entry.children.map(renderNode)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* 窗口拖拽带：macOS 承载红绿灯 Overlay（侧栏通高后）；Windows 为顶部细拖拽条 */}
      <TrafficLightSlot className="h-[44px]" />

      {/* Logo + 空间名 → 弹窗 A */}
      <WorkspaceSwitchPopover
        workspaces={props.workspaces}
        kbs={props.kbs}
        onSwitchWorkspace={props.onSwitchWorkspace}
        onSwitchKb={props.onSwitchKb}
        onCreateWorkspace={props.onCreateWorkspace}
        onCreateKb={props.onCreateKb}
        onManageKbs={props.onManageKbs}
        onManageWorkspaces={props.onManageWorkspaces}
      >
        <button
          type="button"
          aria-label="切换工作空间"
          className="mx-3 mt-3 flex h-10 cursor-default items-center gap-2 rounded-md px-2 transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <BrandLogo size={20} />
          <span className="truncate text-[15px] font-bold">{currentWorkspace?.name}</span>
        </button>
      </WorkspaceSwitchPopover>

      {/* 三个快捷钮 */}
      <div className="mx-3 mt-3 grid grid-cols-3 gap-1">
        {QUICK_ACTIONS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              if (id === "starred") props.onShowStarred();
              else if (id === "note") props.onCreateNote();
              else props.onCreateDoc();
            }}
            className="flex h-[52px] cursor-default flex-col items-center justify-center gap-1 rounded-md text-sidebar-muted transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Icon className="size-[18px]" />
            <span className="text-[11.5px] leading-none">{label}</span>
          </button>
        ))}
      </div>

      {/* 文件夹树（键盘：↑↓ 移动、→/← 展开/折叠、Enter 打开） */}
      <div
        role="tree"
        aria-label="文档树"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="mx-2 mt-4 flex-1 overflow-y-auto px-1 pb-2 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring"
      >
        {props.tree.map(renderEntry)}
      </div>

      {/* 底部「更多」⌘J → 弹窗 B */}
      <div className="mx-3 mb-3 border-t border-dashed border-border pt-2">
        <MoreMenu
          open={props.moreMenuOpen}
          onOpenChange={props.onMoreMenuOpenChange}
          onOpenSettings={props.onOpenSettings}
          onMockAction={props.onMockAction}
        >
          <button
            type="button"
            className="flex h-9 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Ellipsis className="size-4" />
            更多
            <Kbd className="ml-auto">⌘J</Kbd>
          </button>
        </MoreMenu>
      </div>
    </div>
  );
}
