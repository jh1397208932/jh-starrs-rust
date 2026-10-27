import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toErrorMessage } from "@/api/client";
import type { UpdateKnowledgeBaseParams } from "@/api/knowledgeBase";
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
import { useI18n } from "@/lib/i18n";
import type { KnowledgeBase } from "@/types/notebook";
import { ConfirmDialog } from "./ConfirmDialog";
import { KbEditorDialog } from "./KbEditorDialog";

export interface KbManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  kbs: KnowledgeBase[];
  currentKbId: string | null;
  onOpenNewKb: () => void;
  onSwitchKb: (id: string) => Promise<void>;
  onUpdateKb: (id: string, params: UpdateKnowledgeBaseParams) => Promise<void>;
  onDeleteKb: (id: string) => Promise<void>;
}

const GRID = "grid grid-cols-[1fr_1.2fr_64px_44px] items-center gap-3";

/** 弹窗 F · 知识库管理：560×400 模态；支持切换、改名/描述、删除（级联节点） */
export function KbManageDialog({
  open,
  onOpenChange,
  workspaceName,
  kbs,
  currentKbId,
  onOpenNewKb,
  onSwitchKb,
  onUpdateKb,
  onDeleteKb,
}: KbManageDialogProps) {
  const { t } = useI18n();
  const [pendingDelete, setPendingDelete] = useState<KnowledgeBase | null>(null);
  const [editing, setEditing] = useState<KnowledgeBase | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchTo = async (id: string) => {
    if (id === currentKbId || busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await onSwitchKb(id);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[400px] w-[560px] p-5" aria-describedby={undefined}>
        <DialogHeader
          title={t("知识库管理")}
          description={workspaceName}
          actions={
            <Button size="sm" variant="outline" onClick={onOpenNewKb}>
              <Plus className="size-3.5" />
              {t("新建知识库")}
            </Button>
          }
        />

        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}

        <div className="mt-4 flex-1 overflow-y-auto rounded-md border border-border">
          <div
            className={`${GRID} border-b border-border bg-muted px-3 py-2 text-[12px] font-medium text-muted-foreground`}
          >
            <span>{t("名称")}</span>
            <span>{t("描述")}</span>
            <span className="text-right">{t("条目数")}</span>
            <span />
          </div>
          {kbs.length === 0 && (
            <p className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">
              {t("当前工作区还没有知识库")}
            </p>
          )}
          {kbs.map((kb) => {
            const isCurrent = kb.id === currentKbId;
            return (
              <div
                key={kb.id}
                className={`${GRID} border-b border-border/60 px-3 py-2.5 last:border-b-0 ${
                  isCurrent ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => void switchTo(kb.id)}
                  className="flex min-w-0 cursor-default items-center gap-1.5 truncate text-left text-[13px] font-medium disabled:opacity-60"
                >
                  <span className="truncate">{busyId === kb.id ? t("正在切换…") : kb.name}</span>
                  {isCurrent && (
                    <Badge variant="solid" dot>
                      {t("当前")}
                    </Badge>
                  )}
                </button>
                <span className="truncate text-[12.5px] text-muted-foreground">{kb.description || "—"}</span>
                <span className="text-right font-mono text-[12px] text-muted-foreground">
                  <NumberTicker value={kb.docCount} />
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("{name} 操作", { name: kb.name })}
                      className="grid size-7 cursor-default place-items-center justify-self-end rounded-sm text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground"
                    >
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[150px]">
                    <DropdownMenuItem disabled={isCurrent} onSelect={() => void switchTo(kb.id)}>
                      {t("切换")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setEditing(kb)}>
                      <Pencil />
                      {t("编辑")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPendingDelete(kb)}>
                      <Trash2 />
                      {t("删除")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>

        <KbEditorDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          mode="edit"
          initialName={editing?.name ?? ""}
          initialDescription={editing?.description ?? ""}
          onSubmit={async (name, description) => {
            if (editing) await onUpdateKb(editing.id, { name, description });
          }}
        />

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          title={t("删除知识库「{name}」？", { name: pendingDelete?.name ?? "" })}
          description={t("知识库中的所有内容将被永久删除，此操作不可撤销。")}
          onConfirm={async () => {
            if (pendingDelete) await onDeleteKb(pendingDelete.id);
            setPendingDelete(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
