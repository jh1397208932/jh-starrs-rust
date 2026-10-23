/**
 * 领域类型 · 附件对象存储。
 *
 * 与 Rust `models::attachment` 的 IPC DTO 一一对应；物理路径与 pack 细节不下发。
 */

/** 附件状态 */
export type AttachmentStatus = "active" | "deleted";

/** 逻辑附件（用户可见的一行） */
export interface Attachment {
  id: string;
  /** 用户可见文件名（含扩展名） */
  name: string;
  /** 逻辑目录，空串表示工作区根 */
  logicalPath: string;
  /** BLAKE3 64 位小写十六进制 */
  contentHash: string;
  size: number;
  mime: string;
  status: AttachmentStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** 列表查询 */
export interface AttachmentListQuery {
  /** 只列出该逻辑目录；缺省为全部 */
  logicalPath?: string | null;
  /** 是否包含已软删除行 */
  includeDeleted?: boolean;
}

/** 上传参数 */
export interface UploadAttachmentParams {
  /** 本机源文件绝对路径 */
  sourcePath: string;
  /** 逻辑目录，缺省为根 */
  logicalPath?: string;
  /** 覆盖源文件名；缺省取源文件名 */
  name?: string;
  /** 覆盖 MIME 推断 */
  mime?: string;
}

/** 重命名/移动参数；至少提供一个字段 */
export interface UpdateAttachmentParams {
  id: string;
  name?: string;
  logicalPath?: string;
}

/** 删除结果 */
export interface AttachmentDeleteResult {
  id: string;
  contentHash: string;
  /** 删除后该哈希剩余的活跃引用数 */
  remainingReferences: number;
  /** big 文件是否已物理删除；pack 由后台压缩处理 */
  physicalDeleted: boolean;
  /** 是否调度了后台 pack compaction */
  compactionScheduled: boolean;
}

/** 下载参数 */
export interface DownloadAttachmentParams {
  id: string;
  /** 用户选择的目标文件绝对路径 */
  destPath: string;
  /** 目标已存在时是否覆盖 */
  overwrite?: boolean;
}

/** 下载结果 */
export interface AttachmentDownloadResult {
  path: string;
  size: number;
}

/** 校验结果 */
export interface AttachmentVerifyResult {
  id: string;
  contentHash: string;
  expectedSize: number;
  actualSize: number;
  valid: boolean;
  message: string | null;
}

/** 附件与物理对象统计 */
export interface AttachmentStats {
  activeCount: number;
  deletedCount: number;
  /** 活跃附件逻辑大小之和 */
  logicalBytes: number;
  /** 唯一物理对象数 */
  uniqueObjects: number;
  /** 唯一对象大小之和（共享内容只算一份） */
  physicalBytes: number;
  bigObjects: number;
  packObjects: number;
  packCount: number;
  packBytes: number;
  deadPackBytes: number;
}
