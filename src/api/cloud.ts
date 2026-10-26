/**
 * 云同步（同步文件夹）IPC。
 */

import { invokeCommand } from "@/api/client";
import type { Workspace } from "@/types/notebook";

export interface CloudSnapshot {
  path: string;
  createdAt: number;
  workspaceName: string;
}

export interface CloudSyncStatus {
  folder: string | null;
  latest: CloudSnapshot | null;
}

export interface CloudRestoreResult {
  workspace: Workspace;
}

export async function getCloudStatus(): Promise<CloudSyncStatus> {
  return invokeCommand<CloudSyncStatus>("cloud_sync_status");
}

export async function setCloudFolder(folder: string): Promise<CloudSyncStatus> {
  return invokeCommand<CloudSyncStatus>("cloud_set_sync_folder", { input: { folder } });
}

export async function syncWorkspaceToCloud(): Promise<CloudSyncStatus> {
  return invokeCommand<CloudSyncStatus>("cloud_sync_now");
}

export async function restoreLatestFromCloud(targetDir: string): Promise<CloudRestoreResult> {
  return invokeCommand<CloudRestoreResult>("cloud_restore_latest", {
    input: { targetDir },
  });
}
