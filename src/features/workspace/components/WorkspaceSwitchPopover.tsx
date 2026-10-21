import { Database, FolderKanban, Plus, Settings2 } from "lucide-react";
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
  onSwitchWorkspace: (id: string) => void;
  onSwitchKb: (id: string) => void;
  onCreateWorkspace: () => void;
  onCreateKb: () => void;
  onManageKbs: () => void;
  onManageWorkspaces: () => void;
  children: React.ReactNode;
}

/**
 * 弹窗 A · 工作空间切换浮层：280px 锚定 popover（非模态）。
 * 组① 工作空间（头像块 + 名称 + mono 路径）；组② 知识库（主色圆点 + 名称 + 描述）；
 * 尾部：新建工作空间 / 新建知识库 / 管理。
 */
export function WorkspaceSwitchPopover({
  workspaces,
  kbs,
  onSwitchWorkspace,
  onSwitchKb,
  onCreateWorkspace,
  onCreateKb,
  onManageKbs,
  onManageWorkspaces,
  children,
}: WorkspaceSwitchPopoverProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-[280px]">
        <DropdownMenuLabel>工作空间</DropdownMenuLabel>
        {workspaces.map((ws) => (
          <DropdownMenuItem key={ws.id} className="gap-2.5 py-2" onSelect={() => onSwitchWorkspace(ws.id)}>
            <span
              aria-hidden="true"
              className="grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-bold"
              style={{ backgroundColor: ws.avatarColor, color: "var(--primary-foreground)" }}
            >
              {ws.name.charAt(0)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className={ws.isCurrent ? "truncate font-semibold" : "truncate"}>{ws.name}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{ws.path}</span>
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>知识库</DropdownMenuLabel>
        {kbs.map((kb) => (
          <DropdownMenuItem key={kb.id} className="gap-2.5 py-2" onSelect={() => onSwitchKb(kb.id)}>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="flex min-w-0 flex-col">
              <span className={kb.isCurrent ? "truncate font-semibold" : "truncate"}>{kb.name}</span>
              <span className="truncate text-[12px] text-muted-foreground">{kb.description}</span>
            </span>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreateWorkspace}>
          <Plus />
          新建工作空间
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
          管理工作空间
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
