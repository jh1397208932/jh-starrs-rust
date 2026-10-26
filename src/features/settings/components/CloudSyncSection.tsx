import { CloudDownload, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import {
  type CloudSyncStatus,
  getCloudStatus,
  restoreLatestFromCloud,
  setCloudFolder,
  syncWorkspaceToCloud,
} from "@/api/cloud";
import { pickDirectory } from "@/api/directory";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { Workspace } from "@/types/notebook";

export interface CloudSyncSectionProps {
  /** 恢复完成后切换工作区 */
  onRestored: (workspace: Workspace) => Promise<void> | void;
}

/** 设置 · 云同步：通过云盘同步文件夹交换完整工作区快照。 */
export function CloudSyncSection({ onRestored }: CloudSyncSectionProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<CloudSyncStatus | null>(null);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<"connect" | "sync" | "restore" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getCloudStatus()
      .then((current) => {
        if (!active) return;
        setStatus(current);
        setFolder(current.folder ?? "");
      })
      .catch((caught) => {
        if (active) setError(toErrorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (kind: "connect" | "sync" | "restore", action: () => Promise<void>) => {
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

  const connect = (path = folder) =>
    run("connect", async () => {
      const next = await setCloudFolder(path);
      setStatus(next);
      setFolder(next.folder ?? path);
      setNotice(t("已连接"));
    });

  const choose = async () => {
    const selected = await pickDirectory({ title: t("选择同步文件夹") });
    if (!selected) return;
    setFolder(selected);
    await connect(selected);
  };

  const sync = () =>
    run("sync", async () => {
      const next = await syncWorkspaceToCloud();
      setStatus(next);
      setNotice(t("已同步"));
    });

  const restore = () =>
    run("restore", async () => {
      const target = await pickDirectory({ title: t("选择恢复位置（空文件夹）") });
      if (!target) return;
      const result = await restoreLatestFromCloud(target);
      await onRestored(result.workspace);
      setNotice(t("已恢复「{name}」", { name: result.workspace.name }));
    });

  const latest = status?.latest ?? null;
  const connected = Boolean(status?.folder);

  return (
    <div>
      <h3 className="text-[14px] font-semibold">{t("云同步")}</h3>
      <p className={cn(CAPTION_CLS, "mt-1 text-muted-foreground")}>
        {t("选择云盘里的同步文件夹，手动上传或恢复完整工作区。")}
      </p>

      <div className="mt-4 max-w-[520px]">
        <label htmlFor="cloud-folder" className="mb-1.5 block text-[12.5px] font-medium">
          {t("同步文件夹")}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="cloud-folder"
            value={folder}
            placeholder={t("同步文件夹")}
            onChange={(event) => setFolder(event.target.value)}
            className="h-[34px] min-w-0 flex-1 rounded-[8px] border border-input bg-background px-2.5 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void choose()}>
            {t("选择…")}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || folder.trim().length === 0 || folder === status?.folder}
            onClick={() => void connect()}
          >
            {busy === "connect" ? t("连接中…") : connected ? t("保存") : t("连接")}
          </Button>
        </div>

        <div className="mt-3 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
          {latest ? (
            <p className="flex items-center gap-2 text-[12.5px] text-foreground">
              <CloudDownload className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 truncate">
                {t("最新快照：")}
                {latest.workspaceName} · {formatTimestamp(latest.createdAt)}
              </span>
            </p>
          ) : (
            <p className={cn(CAPTION_CLS, "text-muted-foreground")}>
              {connected ? t("还没有同步过快照") : t("连接同步文件夹后可用")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!connected || busy !== null} onClick={() => void sync()}>
              {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {busy === "sync" ? t("同步中…") : t("立即同步")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!latest || busy !== null}
              onClick={() => void restore()}
            >
              {busy === "restore" ? t("恢复中…") : t("从云盘恢复…")}
            </Button>
          </div>
        </div>

        {notice && (
          <p role="status" className={cn(CAPTION_CLS, "mt-2 text-primary")}>
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
