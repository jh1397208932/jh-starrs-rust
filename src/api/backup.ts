/**
 * 工作区备份 / 恢复 IPC。
 */

import { invokeCommand } from "@/api/client";
import type { Workspace } from "@/types/notebook";

export interface BackupWorkspaceResult {
  path: string;
  files: number;
  bytes: number;
}

export interface RestoreWorkspaceResult {
  workspace: Workspace;
}

/**
 * 备份当前工作区到目标父目录；后端创建 `starris-backup-<timestamp>/`。
 * @param destDir 用户选择的目标父目录
 */
export async function backupWorkspace(destDir: string): Promise<BackupWorkspaceResult> {
  return invokeCommand<BackupWorkspaceResult>("backup_workspace", { input: { destDir } });
}

/**
 * 从备份恢复到新的空目录并打开。
 * @param backupDir 备份目录
 * @param targetDir 恢复目标空目录
 */
export async function restoreWorkspace(
  backupDir: string,
  targetDir: string,
): Promise<RestoreWorkspaceResult> {
  return invokeCommand<RestoreWorkspaceResult>("restore_workspace", {
    input: { backupDir, targetDir },
  });
}
