/**
 * 附件 IPC 封装：上传、列表、重命名/移动、删除、导出、校验与统计。
 * 组件禁止直接 invoke，必须经本模块（AGENTS.md §3.3）。
 */

import { invokeCommand, invokeRawCommand } from "@/api/client";
import { mapNode, type NodeDto } from "@/api/node";
import { t } from "@/lib/i18n";
import type {
  Attachment,
  AttachmentDeleteResult,
  AttachmentDownloadResult,
  AttachmentLifecycleParams,
  AttachmentListQuery,
  AttachmentMaintenanceResult,
  AttachmentStats,
  AttachmentVerifyResult,
  DownloadAttachmentParams,
  MaintenanceSettings,
  UpdateAttachmentParams,
  UploadAttachmentParams,
} from "@/types/attachment";
import type { NodeItem } from "@/types/notebook";

/**
 * 上传本机文件到当前工作区附件库。
 * @param params 源文件路径、逻辑目录、可选文件名/MIME
 * @returns 新建的逻辑附件
 * @example await uploadAttachment({ sourcePath: "/Users/me/a.pdf", logicalPath: "docs" });
 */
export async function uploadAttachment(params: UploadAttachmentParams): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_upload", {
    input: {
      sourcePath: params.sourcePath,
      logicalPath: params.logicalPath ?? "",
      name: params.name ?? null,
      mime: params.mime ?? null,
      scope: params.scope ?? null,
      ttlSeconds: params.ttlSeconds ?? null,
    },
  });
}

/**
 * 上传文件并创建左侧树附件节点。
 * @param params 源路径、知识库、父文件夹与可选元数据
 * @returns 新建的附件节点
 * @example await uploadAttachmentToTree({ sourcePath, knowledgeBaseId, parentId });
 */
export async function uploadAttachmentToTree(params: {
  sourcePath: string;
  knowledgeBaseId: string;
  parentId?: string | null;
  logicalPath?: string;
  name?: string;
  mime?: string;
}): Promise<NodeItem> {
  const dto = await invokeCommand<NodeDto>("attachment_upload_to_tree", {
    input: {
      sourcePath: params.sourcePath,
      knowledgeBaseId: params.knowledgeBaseId,
      parentId: params.parentId ?? null,
      logicalPath: params.logicalPath ?? "",
      name: params.name ?? null,
      mime: params.mime ?? null,
    },
  });
  return mapNode(dto);
}

/**
 * 按附件节点读取其对象。
 * @param nodeId 附件节点 id
 * @returns 附件元数据
 * @example await getAttachmentByNode(node.id);
 */
export async function getAttachmentByNode(nodeId: string): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_get_by_node", { nodeId });
}

/**
 * 上传来自剪贴板/拖放的 File（无本地路径）。
 * @param file 浏览器 File 对象
 * @param logicalPath 逻辑目录，缺省为根
 * @returns 新建的逻辑附件
 * @example await uploadAttachmentBytes(file);
 */
export async function uploadAttachmentBytes(file: File, logicalPath = ""): Promise<Attachment> {
  const buffer = await file.arrayBuffer();
  return invokeRawCommand<Attachment>("attachment_upload_bytes", new Uint8Array(buffer), {
    "x-file-name-hex": encodeHex(file.name || t("附件")),
    "x-logical-path-hex": encodeHex(logicalPath),
    "x-file-mime": file.type || "",
  });
}

/**
 * 读取图片附件原始字节，供编辑器生成 Blob URL 预览。
 * @param id 附件 id
 * @returns 原始字节 ArrayBuffer；仅图片且 ≤20 MiB
 * @example const bytes = await readAttachmentBytes(id);
 */
export async function readAttachmentBytes(id: string): Promise<ArrayBuffer> {
  return invokeCommand<ArrayBuffer>("attachment_read_bytes", { id });
}

/**
 * 列出附件。
 * @param query 目录/名称过滤、分页与是否包含软删除
 * @returns 附件数组（默认仅活跃，最多 200 条）
 * @example await listAttachments({ logicalPath: "docs", limit: 50, offset: 0 });
 */ export async function listAttachments(query: AttachmentListQuery = {}): Promise<Attachment[]> {
  return invokeCommand<Attachment[]>("attachment_list", {
    query: {
      logicalPath: query.logicalPath ?? null,
      includeDeleted: query.includeDeleted ?? false,
      search: query.search ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
    },
  });
}

/**
 * 读取单条活跃附件。
 * @param id 附件 id
 * @returns 附件
 * @example await getAttachment(attachment.id);
 */
export async function getAttachment(id: string): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_get", { id });
}

/**
 * 重命名或移动逻辑附件（只改元数据）。
 * @param params id 与可选的新名称/新目录
 * @returns 更新后的附件
 * @example await updateAttachment({ id, name: "新名字.pdf" });
 */
export async function updateAttachment(params: UpdateAttachmentParams): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_update", {
    input: {
      id: params.id,
      name: params.name ?? null,
      logicalPath: params.logicalPath ?? null,
    },
  });
}

/**
 * 软删除附件；物理文件在引用归零后由后端异步清理。
 * @param id 附件 id
 * @returns 引用计数与物理删除结果
 * @example await deleteAttachment(id);
 */
export async function deleteAttachment(id: string): Promise<AttachmentDeleteResult> {
  return invokeCommand<AttachmentDeleteResult>("attachment_delete", { id });
}

/**
 * 从回收站恢复附件。
 * @param id 附件 id
 * @returns 恢复后的附件
 * @example await restoreAttachment(id);
 */
export async function restoreAttachment(id: string): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_restore", { id });
}

/**
 * 设置未关联附件的临时保留时间。
 * @param params 附件 id 与秒数；null 表示永久
 * @returns 更新后的附件
 * @example await setAttachmentLifecycle({ id, ttlSeconds: 86400 });
 */
export async function setAttachmentLifecycle(params: AttachmentLifecycleParams): Promise<Attachment> {
  return invokeCommand<Attachment>("attachment_set_lifecycle", {
    input: { id: params.id, ttlSeconds: params.ttlSeconds },
  });
}

/**
 * 立即执行一轮附件维护（孤儿、TTL、回收站、staging、孤儿 blob、pack）。
 * @returns 本轮清理计数
 * @example const result = await runAttachmentMaintenance();
 */
export async function runAttachmentMaintenance(): Promise<AttachmentMaintenanceResult> {
  return invokeCommand<AttachmentMaintenanceResult>("attachment_maintenance");
}

/**
 * 读取当前工作区的附件保留策略。
 * @returns 孤儿/回收站/暂存的保留时长
 * @example const policy = await getMaintenanceSettings();
 */
export async function getMaintenanceSettings(): Promise<MaintenanceSettings> {
  return invokeCommand<MaintenanceSettings>("attachment_maintenance_settings");
}

/**
 * 保存当前工作区的附件保留策略。
 * @param settings 天数与小时数，范围由后端校验
 * @returns 保存后的策略
 * @example await updateMaintenanceSettings({ orphanGraceDays: 7, trashRetentionDays: 30, stagingMaxAgeHours: 24 });
 */
export async function updateMaintenanceSettings(settings: MaintenanceSettings): Promise<MaintenanceSettings> {
  return invokeCommand<MaintenanceSettings>("attachment_update_maintenance_settings", {
    input: settings,
  });
}

/**
 * 流式导出附件到目标路径。
 * @param params id、目标路径与是否覆盖
 * @returns 实际写入路径与大小
 * @example await downloadAttachment({ id, destPath: "/Users/me/Downloads/a.pdf", overwrite: true });
 */
export async function downloadAttachment(
  params: DownloadAttachmentParams,
): Promise<AttachmentDownloadResult> {
  return invokeCommand<AttachmentDownloadResult>("attachment_download", {
    input: {
      id: params.id,
      destPath: params.destPath,
      overwrite: params.overwrite ?? false,
    },
  });
}

/**
 * 流式校验附件哈希与大小。
 * @param id 附件 id
 * @returns 校验结果；损坏时不抛错
 * @example const result = await verifyAttachment(id);
 */
export async function verifyAttachment(id: string): Promise<AttachmentVerifyResult> {
  return invokeCommand<AttachmentVerifyResult>("attachment_verify", { id });
}

/**
 * 读取当前工作区的附件统计。
 * @returns 活跃/删除数、逻辑/物理大小与 pack 统计
 * @example const stats = await getAttachmentStats();
 */
export async function getAttachmentStats(): Promise<AttachmentStats> {
  return invokeCommand<AttachmentStats>("attachment_stats");
}

/** 把字符串编码为 ASCII hex，供 raw IPC headers 传递同名/路径。 */
function encodeHex(value: string): string {
  let result = "";
  for (const byte of new TextEncoder().encode(value)) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}
