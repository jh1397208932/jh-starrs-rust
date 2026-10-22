import { Ellipsis, Plus, Star, StickyNote } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import { Kbd } from "@/components/ui/empty-state";
import type { KnowledgeBase, NodeItem, TreeNode, Workspace } from "@/types/notebook";
import { FileTree } from "./FileTree";
import { MoreMenu } from "./MoreMenu";
import { WorkspaceSwitchPopover } from "./WorkspaceSwitchPopover";

export interface SidebarProps {
  workspaces: Workspace[];
  kbs: KnowledgeBase[];
  currentWorkspace: Workspace;
  currentKb: KnowledgeBase | null;
  tree: TreeNode[];
  nodes: NodeItem[];
  /** 当前激活标签对应节点，用于树选中态 */
  selectedNodeId: string | null;
  moreMenuOpen: boolean;
  onMoreMenuOpenChange: (open: boolean) => void;
  onSwitchWorkspace: (id: string) => void;
  onSwitchKb: (id: string) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onCreateKb: () => void;
  onManageKbs: () => void;
  onManageWorkspaces: () => void;
  onOpenSettings: () => void;
  onMockAction: (label: string) => void;
  onShowStarred: () => void;
  onCreateNote: () => void;
  onCreateDoc: () => void;
  onOpenNode: (node: NodeItem) => void;
  onCreateRootNode: () => void;
  onCreateChildNode: (parent: NodeItem) => void;
  onRenameNode: (node: NodeItem) => void;
  onDeleteNode: (node: NodeItem) => void;
  onMoveNode: (id: string, parentId: string | null, index: number) => Promise<void>;
  onError: (message: string) => void;
}

const QUICK_ACTIONS = [
  { id: "starred", icon: Star, label: "收藏" },
  { id: "note", icon: StickyNote, label: "小记" },
  { id: "new", icon: Plus, label: "新建" },
] as const;

/**
 * 232px 通高左侧列：窗口拖拽带（macOS 红绿灯）→ 工作区入口 → 三快捷钮
 * → 文件树（任意层级 + 拖拽）→ 底部更多(⌘J)。全部使用 --sidebar-* 令牌组。
 */
export function Sidebar(props: SidebarProps) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <TrafficLightSlot className="h-[44px]" />

      <WorkspaceSwitchPopover
        workspaces={props.workspaces}
        kbs={props.kbs}
        currentKbId={props.currentKb?.id ?? null}
        onSwitchWorkspace={props.onSwitchWorkspace}
        onSwitchKb={props.onSwitchKb}
        onCreateWorkspace={props.onCreateWorkspace}
        onOpenWorkspace={props.onOpenWorkspace}
        onCreateKb={props.onCreateKb}
        onManageKbs={props.onManageKbs}
        onManageWorkspaces={props.onManageWorkspaces}
      >
        <button
          type="button"
          aria-label="切换工作区"
          className="mx-3 mt-3 flex h-10 cursor-default items-center gap-2 rounded-md px-2 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <BrandLogo size={20} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[15px] font-bold leading-tight">
              {props.currentWorkspace.name}
            </span>
            <span className="truncate text-[11px] leading-tight text-sidebar-muted">
              {props.currentKb?.name ?? "未选择知识库"}
            </span>
          </span>
        </button>
      </WorkspaceSwitchPopover>

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

      <FileTree
        tree={props.tree}
        nodes={props.nodes}
        currentKbName={props.currentKb?.name ?? null}
        selectedNodeId={props.selectedNodeId}
        onOpenNode={props.onOpenNode}
        onCreateRoot={props.onCreateRootNode}
        onCreateChild={props.onCreateChildNode}
        onRename={props.onRenameNode}
        onDelete={props.onDeleteNode}
        onMove={props.onMoveNode}
        onError={props.onError}
      />

      <div className="mx-3 mb-3 border-t border-dashed border-border pt-2">
        <MoreMenu
          open={props.moreMenuOpen}
          onOpenChange={props.onMoreMenuOpenChange}
          onOpenSettings={props.onOpenSettings}
          onMockAction={props.onMockAction}
        >
          <button
            type="button"
            className="flex h-9 w-full cursor-default items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
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
