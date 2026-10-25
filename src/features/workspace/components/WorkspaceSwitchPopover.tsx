import { Check, Database, FolderKanban, FolderOpen, Plus, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KnowledgeBase, Workspace } from "@/types/notebook";

export interface WorkspaceSwitchPopoverProps {
  workspaces: Workspace[];
  kbs: KnowledgeBase[];
  /** 当前知识库 id；null = 工作区还没有知识库 */
  currentKbId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onSwitchKb: (id: string) => void;
  onCreateWorkspace: () => void;
  /** 选择本地目录并打开已有工作区 */
  onOpenWorkspace: () => void;
  onCreateKb: () => void;
  onManageKbs: () => void;
  onManageWorkspaces: () => void;
  children: React.ReactNode;
}

/**
 * 左上角工作区入口浮层：工作区列表（查询/切换）、知识库列表、
 * 新建工作区、打开已有目录、管理与设置入口。
 */
export function WorkspaceSwitchPopover({
  workspaces,
  kbs,
  currentKbId,
  onSwitchWorkspace,
  onSwitchKb,
  onCreateWorkspace,
  onOpenWorkspace,
  onCreateKb,
  onManageKbs,
  onManageWorkspaces,
  children,
}: WorkspaceSwitchPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-[300px]">
        <DropdownMenuLabel>工作区</DropdownMenuLabel>
        {workspaces.length === 0 && (
          <p className="px-2 py-1.5 text-[12px] text-muted-foreground">还没有工作区</p>
        )}
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            className="gap-2.5 py-2"
            onSelect={() => onSwitchWorkspace(workspace.id)}
          >
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-bold"
              style={{ backgroundColor: workspace.avatarColor, color: "var(--primary-foreground)" }}
            >
              {workspace.name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={workspace.isCurrent ? "truncate font-semibold" : "truncate"}>
                {workspace.name}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{workspace.path}</span>
            </span>
            {workspace.isCurrent && <Check className="size-3.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>知识库</DropdownMenuLabel>
        {kbs.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">还没有知识库</p>}
        {kbs.map((kb) => (
          <DropdownMenuItem key={kb.id} className="gap-2.5 py-2" onSelect={() => onSwitchKb(kb.id)}>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={currentKbId === kb.id ? "truncate font-semibold" : "truncate"}>{kb.name}</span>
              {kb.description ? (
                <span className="truncate text-[12px] text-muted-foreground">{kb.description}</span>
              ) : null}
            </span>
            {currentKbId === kb.id && <Check className="size-3.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreateWorkspace}>
          <Plus />
          新建工作区
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenWorkspace}>
          <FolderOpen />
          打开已有工作区…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCreateKb}>
          <Database />
          新建知识库
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onManageKbs}>
          <FolderKanban />
          管理知识库
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onManageWorkspaces}>
          <Settings2 />
          管理工作区
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
