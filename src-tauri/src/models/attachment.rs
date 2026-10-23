//! 附件领域类型、IPC 契约与固定状态值。

use serde::{Deserialize, Serialize};

/// 活跃附件状态。
pub const STATUS_ACTIVE: &str = "active";
/// 大对象存储类型。
pub const KIND_BIG: &str = "big";
/// pack 小对象存储类型。
pub const KIND_PACK: &str = "pack";

/// 附件逻辑行（数据库映射）。
#[derive(Debug, Clone)]
pub struct AttachmentRow {
    pub id: String,
    pub name: String,
    pub logical_path: String,
    pub content_hash: String,
    pub size: i64,
    pub mime: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

impl AttachmentRow {
    /// 转成前端 DTO；不暴露物理路径与 pack 细节。
    pub fn to_dto(&self) -> AttachmentDto {
        AttachmentDto {
            id: self.id.clone(),
            name: self.name.clone(),
            logical_path: self.logical_path.clone(),
            content_hash: self.content_hash.clone(),
            size: self.size,
            mime: self.mime.clone(),
            status: self.status.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            deleted_at: self.deleted_at,
        }
    }
}

/// 物理对象行（数据库映射）。
///
/// 不存引用计数：物理对象是否存在，唯一判据是"还有没有活跃 `attachment` 行引用这个
/// 哈希"（`repositories::count_active_references`）。blob 行只在被引用期间存在。
#[derive(Debug, Clone)]
pub struct AttachmentBlobRow {
    pub hash: String,
    pub size: i64,
    pub storage_kind: String,
    pub pack_id: Option<String>,
    pub pack_offset: Option<i64>,
    pub created_at: i64,
}

/// pack 行（数据库映射）。
#[derive(Debug, Clone)]
pub struct AttachmentPackRow {
    pub id: String,
    pub file_name: String,
    pub size: i64,
    pub active: bool,
    pub created_at: i64,
    pub retired_at: Option<i64>,
}

/// 附件 IPC 输出。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDto {
    pub id: String,
    pub name: String,
    pub logical_path: String,
    pub content_hash: String,
    pub size: i64,
    pub mime: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

/// 上传入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAttachmentInput {
    /// 本机源文件绝对路径（由文件选择器返回）。
    pub source_path: String,
    /// 逻辑目录；空串表示工作区根。
    #[serde(default)]
    pub logical_path: String,
    /// 用户可见文件名；缺省取源文件名。
    #[serde(default)]
    pub name: Option<String>,
    /// 调用方提供的 MIME；缺省按扩展名推断。
    #[serde(default)]
    pub mime: Option<String>,
}

/// 列表查询。
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentListQuery {
    /// 只列出该逻辑目录；None 表示全部。
    #[serde(default)]
    pub logical_path: Option<String>,
    /// 是否包含已软删除行。
    #[serde(default)]
    pub include_deleted: bool,
}

/// 重命名/移动入参；至少提供一个字段。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAttachmentInput {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub logical_path: Option<String>,
}

/// 下载入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAttachmentInput {
    pub id: String,
    /// 用户选择的目标文件绝对路径。
    pub dest_path: String,
    #[serde(default)]
    pub overwrite: bool,
}

/// 下载结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadAttachmentResult {
    pub path: String,
    pub size: i64,
}

/// 删除结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDeleteResult {
    pub id: String,
    pub content_hash: String,
    /// 删除这条逻辑引用后，该哈希剩余的活跃引用数。
    pub remaining_references: i64,
    /// 是否已执行物理删除（big 文件 unlink；pack 由 compaction 处理时为 false）。
    pub physical_deleted: bool,
    /// 是否调度了后台 pack compaction。
    pub compaction_scheduled: bool,
}

/// 校验结果；损坏不抛错，由 valid/message 表达。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentVerifyResult {
    pub id: String,
    pub content_hash: String,
    pub expected_size: i64,
    pub actual_size: i64,
    pub valid: bool,
    pub message: Option<String>,
}

/// 附件与物理对象统计。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentStatsDto {
    pub active_count: i64,
    pub deleted_count: i64,
    /// 活跃附件的逻辑大小之和。
    pub logical_bytes: i64,
    /// 当前物理对象数（blob 行数）。
    pub unique_objects: i64,
    /// blob 行对应的大小之和（含共享对象只算一份）。
    pub physical_bytes: i64,
    pub big_objects: i64,
    pub pack_objects: i64,
    pub pack_count: i64,
    pub pack_bytes: i64,
    /// pack 文件实际长度 − 活跃条目长度（含崩溃遗留尾部）。
    pub dead_pack_bytes: i64,
}
