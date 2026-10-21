import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { NumberTicker } from "@/components/common/motion/NumberTicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KnowledgeBase } from "@/types/notebook";
import { ConfirmDialog } from "./ConfirmDialog";

export interface KbManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  kbs: KnowledgeBase[];
  onOpenNewKb: () => void;
  onSwitchKb: (id: string) => void;
  onDeleteKb: (id: string) => void;
  onMockAction: (label: string) => void;
}

const GRID = "grid grid-cols-[1fr_1.2fr_64px_44px] items-center gap-3";

/** 弹窗 F · 知识库管理：560×400 模态；当前库 = bg-accent + 主色圆点「当前」徽标 */
export function KbManageDialog({
  open,
  onOpenChange,
  workspaceName,
  kbs,
  onOpenNewKb,
  onSwitchKb,
  onDeleteKb,
  onMockAction,
}: KbManageDialogProps) {
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBase | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[400px] w-[560px] p-5" aria-describedby={undefined}>
        <DialogHeader
          title="知识库管理"
          description={workspaceName}
          actions={
            <Button size="sm" variant="outline" onClick={onOpenNewKb}>
              <Plus className="size-3.5" />
              新建知识库
            </Button>
          }
        />

        <div className="mt-4 flex-1 overflow-y-auto rounded-md border border-border">
          <div
            className={`${GRID} border-b border-border bg-muted px-3 py-2 text-[12px] font-medium text-muted-foreground`}
          >
            <span>名称</span>
            <span>描述</span>
            <span className="text-right">文档数</span>
            <span />
          </div>
          {kbs.map((kb) => (
            <div
              key={kb.id}
              className={`${GRID} border-b border-border/60 px-3 py-2.5 last:border-b-0 ${
                kb.isCurrent ? "bg-accent text-accent-foreground" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onSwitchKb(kb.id)}
                className="flex min-w-0 cursor-default items-center gap-1.5 truncate text-left text-[13px] font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                {kb.name}
                {kb.isCurrent && (
                  <Badge variant="solid" dot>
                    当前
                  </Badge>
                )}
              </button>
              <span className="truncate text-[12.5px] text-muted-foreground">{kb.description}</span>
              <span className="text-right font-mono text-[12px] text-muted-foreground">
                <NumberTicker value={kb.docCount} />
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${kb.name} 操作`}
                    className="grid size-7 cursor-default place-items-center justify-self-end rounded-sm text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <Ellipsis className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[140px]">
                  <DropdownMenuItem onSelect={() => onMockAction("重命名知识库")}>
                    <Pencil />
                    重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPendingDelete(kb)}>
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
          title={`删除知识库「${pendingDelete?.name ?? ""}」？`}
          description="该知识库内的所有文档与画板将被移除，此操作不可撤销。"
          onConfirm={() => {
            if (pendingDelete) onDeleteKb(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
