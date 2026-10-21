import { ArrowLeftRight, Ellipsis, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Workspace } from "@/types/notebook";
import { ConfirmDialog } from "./ConfirmDialog";

export interface WsManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  onSwitchWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  /** 删除当前空间时 toast 提示 */
  onDeleteCurrentDenied: () => void;
}

/** 弹窗 G · 工作空间管理：560×400 模态，与知识库管理同构 */
export function WsManageDialog({
  open,
  onOpenChange,
  workspaces,
  onSwitchWorkspace,
  onDeleteWorkspace,
  onDeleteCurrentDenied,
}: WsManageDialogProps) {
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[400px] w-[560px] p-5" aria-describedby={undefined}>
        <DialogHeader title="工作空间管理" description={`共 ${workspaces.length} 个工作空间`} />

        <div className="mt-4 flex-1 overflow-y-auto rounded-md border border-border">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-b-0 ${
                ws.isCurrent ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className="grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-bold"
                style={{ backgroundColor: ws.avatarColor, color: "var(--primary-foreground)" }}
              >
                {ws.name.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 truncate text-[13px] font-medium">
                  {ws.name}
                  {ws.isCurrent && (
                    <Badge variant="solid" dot>
                      当前
                    </Badge>
                  )}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{ws.path}</span>
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${ws.name} 操作`}
                    className="grid size-7 cursor-default place-items-center rounded-sm text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <Ellipsis className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[140px]">
                  <DropdownMenuItem onSelect={() => onSwitchWorkspace(ws.id)}>
                    <ArrowLeftRight />
                    切换到此空间
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => (ws.isCurrent ? onDeleteCurrentDenied() : setPendingDelete(ws))}
                  >
                    <Trash2 />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          title={`删除工作空间「${pendingDelete?.name ?? ""}」？`}
          description="该工作空间下的所有知识库与文档将被移除，此操作不可撤销。"
          onConfirm={() => {
            if (pendingDelete) onDeleteWorkspace(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
