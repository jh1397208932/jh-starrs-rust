import { ArchiveRestore, HardDriveDownload, Loader2 } from "lucide-react";
import { useState } from "react";
import { backupWorkspace, restoreWorkspace } from "@/api/backup";
import { toErrorMessage } from "@/api/client";
import { pickDirectory } from "@/api/directory";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { Workspace } from "@/types/notebook";

export interface BackupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
  /** 恢复成功并切换后回调；调用方负责刷新前端工作区状态。 */
  onRestored: (workspace: Workspace) => Promise<void> | void;
}

/**
 * 备份与恢复：备份复制 DB + storage/objects；恢复只允许写入空目录。
 */
export function BackupDialog({ open, onOpenChange, workspaceName, onRestored }: BackupDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: "backup" | "restore", action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    setNotice(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const backup = () =>
    run("backup", async () => {
      const dest = await pickDirectory({ title: t("选择备份位置") });
      if (!dest) return;
      const result = await backupWorkspace(dest);
      setNotice(t("已备份到 {path}", { path: result.path }));
    });

  const restore = () =>
    run("restore", async () => {
      const backupDir = await pickDirectory({ title: t("选择备份文件夹") });
      if (!backupDir) return;
      const targetDir = await pickDirectory({ title: t("选择恢复目标（空文件夹）") });
      if (!targetDir) return;
      const result = await restoreWorkspace(backupDir, targetDir);
      await onRestored(result.workspace);
      setNotice(t("已恢复「{name}」", { name: result.workspace.name }));
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[480px] p-5" aria-describedby={undefined}>
        <DialogTitle>{t("备份与恢复")}</DialogTitle>
        <p className={cn(CAPTION_CLS, "mt-1 text-muted-foreground")}>
          {t("当前工作区：")}
          {workspaceName}
        </p>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void backup()}
            className="flex items-start gap-3 rounded-[12px] border border-border/70 bg-card px-3.5 py-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/40 disabled:opacity-60"
          >
            <HardDriveDownload className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <span className="block text-[13px] font-medium">{t("备份当前工作区")}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                {t("复制数据库与附件对象到一个新文件夹")}
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void restore()}
            className="flex items-start gap-3 rounded-[12px] border border-border/70 bg-card px-3.5 py-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/40 disabled:opacity-60"
          >
            <ArchiveRestore className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <span className="block text-[13px] font-medium">{t("从备份恢复")}</span>
              <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                {t("恢复到空文件夹，并切换为当前工作区")}
              </span>
            </span>
          </button>
        </div>

        {busy && (
          <p className={cn(CAPTION_CLS, "mt-3 inline-flex items-center gap-1.5 text-muted-foreground")}>
            <Loader2 className="size-3.5 animate-spin" />
            {busy === "backup" ? t("正在备份…") : t("正在恢复…")}
          </p>
        )}
        {notice && (
          <p role="status" className={cn(CAPTION_CLS, "mt-3 break-all text-primary")}>
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-[12px] text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => onOpenChange(false)}>
            {t("关闭")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
