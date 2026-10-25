import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Workspace } from "@/types/notebook";

export interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待删除工作区 */
  workspace: Workspace | null;
  /** 是否为当前连接工作区（删除后自动切换） */
  isCurrent: boolean;
  /** 确认删除；deleteFolder = 是否连同本地文件夹删除 */
  onDelete: (deleteFolder: boolean) => Promise<void>;
}

/**
 * 删除工作区确认：明确区分“只移除登记”与“同时删除本地文件夹”。
 * 默认不勾选删除文件夹，降低误删风险；当前工作区会由后端自动切换。
 */
export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  isCurrent,
  onDelete,
}: DeleteWorkspaceDialogProps) {
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDeleteFolder(false);
    setPending(false);
    setError(null);
  }, [open]);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onDelete(deleteFolder);
      onOpenChange(false);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[400px] p-5" aria-describedby={undefined}>
        <DialogTitle>删除工作区「{workspace?.name ?? ""}」？</DialogTitle>
        <DialogDescription className="mt-1.5">
          {isCurrent ? "当前工作区，删除后将自动切换。" : "从列表中移除。"}
        </DialogDescription>

        <div className="mt-3 rounded-md border border-border bg-muted/60 px-3 py-2">
          <p className="text-[11.5px] text-muted-foreground">位置</p>
          <code className="mt-0.5 block truncate font-mono text-[11.5px]">{workspace?.path}</code>
        </div>

        <label
          htmlFor="delete-workspace-folder"
          className="mt-3 flex cursor-default items-start gap-2 rounded-md border border-border p-3 text-[12.5px]"
        >
          <input
            id="delete-workspace-folder"
            type="checkbox"
            checked={deleteFolder}
            disabled={pending}
            onChange={(event) => setDeleteFolder(event.target.checked)}
            className="mt-0.5 size-4 accent-[var(--destructive)]"
          />
          <span>
            <span className="block font-medium">同时删除本地文件夹</span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
              将永久删除文件夹中的所有内容，不可恢复。
            </span>
          </span>
        </label>

        {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" size="sm" disabled={pending} onClick={() => void confirm()}>
            {pending ? "处理中…" : deleteFolder ? "删除文件夹" : "移除"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
