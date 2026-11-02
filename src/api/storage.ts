/**
 * 工作区存储占用 IPC 封装：Settings 存储页的分类磁盘字节。
 * 组件禁止直接 invoke，必须经本模块（AGENTS.md §3.3）。
 */

import { invokeCommand } from "@/api/client";

/**
 * 当前工作区的分类磁盘占用；与 Rust `workspace_storage_stats` 的 camelCase 契约一一对应。
 * 口径：totalBytes = databaseBytes + attachmentBytes + tempBytes + quarantineBytes；
 * trashBytes 的物理对象仍留在 pack/big 内，已含在 attachmentBytes 中，不重复相加。
 */
export interface WorkspaceStorageStats {
  /** 工作区总字节（数据库+附件物理+暂存+隔离区）。 */
  totalBytes: number;
  /** SQLite 主文件与 -wal、-shm 伴生文件的字节数。 */
  databaseBytes: number;
  /** 附件物理对象（pack + big）在磁盘上的实际字节数。 */
  attachmentBytes: number;
  /** 回收站（软删除）附件的逻辑字节数；物理对象已计入 attachmentBytes。 */
  trashBytes: number;
  /** storage/tmp 上传暂存区残留文件字节数。 */
  tempBytes: number;
  /** storage/quarantine 孤儿对象隔离区字节数。 */
  quarantineBytes: number;
  /** 可回收空间估算（回收站+孤儿+死 pack 字节）。 */
  reclaimableBytes: number;
  /** 存储所在磁盘剩余字节；平台无法读取时为 null。 */
  diskFreeBytes: number | null;
  /** 最近一次附件维护时间（Unix 毫秒）；从未执行为 null。 */
  lastMaintenanceAt: number | null;
}

/**
 * 读取当前工作区的分类磁盘占用。
 * @returns 工作区总量/数据库/附件/回收站/暂存/隔离区字节细分
 * @example const stats = await getWorkspaceStorageStats(); // stats.totalBytes
 */
export async function getWorkspaceStorageStats(): Promise<WorkspaceStorageStats> {
  return invokeCommand<WorkspaceStorageStats>("workspace_storage_stats");
}
