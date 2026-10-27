import { ArrowLeftRight, Ellipsis, Pencil, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import type { Workspace } from "@/types/notebook";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";
import { NameDialog } from "./NameDialog";

export interface WsManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  onSwitch: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string, deleteFolder: boolean) => Promise<void>;
}

/**
 * 弹窗 G · 工作区管理：560×420 模态。
 * 支持按名称/路径查询、切换、改名（只改全局显示名）与删除（可选删文件夹）。
 */
export function WsManageDialog({
  open,
  onOpenChange,
  workspaces,
  currentWorkspaceId,
  onSwitch,
  onRename,
  onDelete,
}: WsManageDialogProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Workspace | null>(null);
  const [renaming, setRenaming] = useState<Workspace | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return workspaces;
    return workspaces.filter(
      (workspace) =>
        workspace.name.toLowerCase().includes(keyword) || workspace.path.toLowerCase().includes(keyword),
    );
  }, [workspaces, query]);

  const switchTo = async (id: string) => {
    if (id === currentWorkspaceId || busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await onSwitch(id);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[440px] w-[560px] p-5" aria-describedby={undefined}>
        <DialogHeader
          title={t("工作区管理")}
          description={t("共 {count} 个工作区", { count: workspaces.length })}
        />

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder={t("搜索…")}
            aria-label={t("查询工作区")}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8 text-[12.5px]"
          />
        </div>

        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}

        <div className="mt-3 flex-1 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 && (
            <p className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">
              {workspaces.length === 0 ? t("还没有工作区") : t("没有匹配的工作区")}
            </p>
          )}
          {filtered.map((workspace) => {
            const isCurrent = workspace.id === currentWorkspaceId;
            return (
              <div
                key={workspace.id}
                className={`flex items-center gap-3 border-b border-border/60 px-3 py-3 last:border-b-0 ${
                  isCurrent ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-bold"
                  style={{ backgroundColor: workspace.avatarColor, color: "var(--primary-foreground)" }}
                >
                  {workspace.name.charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 truncate text-[13px] font-medium">
                    {busyId === workspace.id ? t("正在切换…") : workspace.name}
                    {isCurrent && (
                      <Badge variant="solid" dot>
                        {t("当前")}
                      </Badge>
                    )}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {workspace.path}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatTimestamp(workspace.lastOpenedAt)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("{name} 操作", { name: workspace.name })}
                      className="grid size-7 cursor-default place-items-center rounded-sm text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary hover:text-foreground"
                    >
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[160px]">
                    <DropdownMenuItem
                      disabled={isCurrent || busyId !== null}
                      onSelect={() => void switchTo(workspace.id)}
                    >
                      <ArrowLeftRight />
                      {t("切换")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRenaming(workspace)}>
                      <Pencil />
                      {t("重命名")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPendingDelete(workspace)}>
                      <Trash2 />
                      {t("删除")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>

        <NameDialog
          open={renaming !== null}
          onOpenChange={(next) => {
            if (!next) setRenaming(null);
          }}
          title={t("重命名工作区")}
          label={t("名称")}
          initialValue={renaming?.name ?? ""}
          maxLength={80}
          submitLabel={t("保存")}
          onSubmit={async (name) => {
            if (renaming) await onRename(renaming.id, name);
          }}
        />

        <DeleteWorkspaceDialog
          open={pendingDelete !== null}
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          workspace={pendingDelete}
          isCurrent={pendingDelete?.id === currentWorkspaceId}
          onDelete={async (deleteFolder) => {
            if (pendingDelete) await onDelete(pendingDelete.id, deleteFolder);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
