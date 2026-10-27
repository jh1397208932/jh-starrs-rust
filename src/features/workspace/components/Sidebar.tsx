import { ChevronsUpDown, Ellipsis, Plus, Star, StickyNote } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { TrafficLightSlot } from "@/components/common/TrafficLightSlot";
import { useI18n } from "@/lib/i18n";
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
  /** 打开整库导出弹窗 */
  onAllExport: () => void;
  /** 打开导入弹窗（根级） */
  onImport: () => void;
  /** 直接导入思维导图文件 */
  onImportMindmap: () => void;
  /** 导入到指定文件夹 */
  onImportToFolder: (parent: NodeItem) => void;
  /** 上传附件到根或指定文件夹 */
  onUploadAttachment: (parent: NodeItem | null) => void;
  /** 打开组件库管理 */
  onOpenLibrary: () => void;
  /** 打开备份与恢复 */
  onBackup: () => void;
  /** 打开模板库 */
  onTemplates: () => void;
  /** 打开文件回收站 */
  onNodeTrash: () => void;
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
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
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
          aria-label={t("切换工作区")}
          className="workspace-brand group mx-3 mt-2 flex h-11 cursor-default items-center gap-2.5 px-1.5 text-left"
        >
          <span className="grid size-8 shrink-0 place-items-center">
            <BrandLogo size={26} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-semibold leading-tight tracking-[-0.01em]">
              {props.currentWorkspace.name}
            </span>
            <span className="truncate text-[10.5px] leading-tight text-sidebar-muted">
              {props.currentKb?.name ?? t("未选择知识库")}
            </span>
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-sidebar-muted opacity-0 transition-opacity duration-150 ease-[var(--ease)] group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </WorkspaceSwitchPopover>

      <div className="mx-3 mt-2 grid grid-cols-3 gap-1">
        {QUICK_ACTIONS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            type="button"
            data-kind={id}
            onClick={() => {
              if (id === "starred") props.onShowStarred();
              else if (id === "note") props.onCreateNote();
              else props.onCreateDoc();
            }}
            className="quick-action cursor-default"
          >
            <span className="quick-action__icon">
              <Icon className="size-4" strokeWidth={1.8} />
            </span>
            <span>{t(label)}</span>
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
        onImportToFolder={props.onImportToFolder}
        onUploadAttachment={props.onUploadAttachment}
        onError={props.onError}
      />

      <div className="mx-3 mb-3 pt-1">
        <MoreMenu
          open={props.moreMenuOpen}
          onOpenChange={props.onMoreMenuOpenChange}
          onOpenSettings={props.onOpenSettings}
          onAllExport={props.onAllExport}
          onImport={props.onImport}
          onImportMindmap={props.onImportMindmap}
          onOpenLibrary={props.onOpenLibrary}
          onBackup={props.onBackup}
          onTemplates={props.onTemplates}
          onNodeTrash={props.onNodeTrash}
        >
          <button
            type="button"
            className="sidebar-row flex h-9 w-full cursor-default items-center gap-2 px-2 text-[13px] text-sidebar-foreground"
          >
            <Ellipsis className="size-4 text-sidebar-muted" />
            {t("更多")}
            <span className="ml-auto font-mono text-[11px] text-sidebar-muted">⌘J</span>
          </button>
        </MoreMenu>
      </div>
    </div>
  );
}
