//! 附件领域类型、IPC 契约与固定状态值。

use serde::{Deserialize, Serialize};

/// 活跃附件状态。
pub const STATUS_ACTIVE: &str = "active";
/// 回收站状态；保留物理对象以便恢复。
pub const STATUS_DELETED: &str = "deleted";
/// 存储管理上传、无节点引用也保留。
pub const SCOPE_LIBRARY: &str = "library";
/// 由文档/画板/附件节点产生，失去引用后进入孤儿流程。
pub const SCOPE_NODE: &str = "node";
/// 文档内嵌预览图的内部逻辑目录；不出现在附件选择器里。
pub const PREVIEW_LOGICAL_PATH: &str = "__preview";
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
    pub scope: String,
    pub expires_at: Option<i64>,
    pub orphaned_at: Option<i64>,
    pub reference_count: i64,
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
            scope: self.scope.clone(),
            expires_at: self.expires_at,
            orphaned_at: self.orphaned_at,
            reference_count: self.reference_count,
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
    pub scope: String,
    pub expires_at: Option<i64>,
    pub orphaned_at: Option<i64>,
    /// 当前被多少个节点引用；0 表示未关联。
    pub reference_count: i64,
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
    /// 来源作用域：library（默认）或 node；由服务端校验。
    #[serde(default)]
    pub scope: Option<String>,
    /// 临时保留时长（秒）；仅对未关联附件生效，None 表示不设 TTL。
    #[serde(default)]
    pub ttl_seconds: Option<i64>,
}

/// 从文件树直接上传附件并创建节点。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadAttachmentNodeInput {
    pub source_path: String,
    pub knowledge_base_id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub logical_path: String,
    #[serde(default)]
    pub name: Option<String>,
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
    /// 名称/目录模糊搜索；None 表示不过滤。
    #[serde(default)]
    pub search: Option<String>,
    /// 返回条数；None 使用默认 50，服务层限制最大 200。
    #[serde(default)]
    pub limit: Option<i64>,
    /// 偏移量；None 视为 0。
    #[serde(default)]
    pub offset: Option<i64>,
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

/// 设置未关联附件的临时保留时间。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentLifecycleInput {
    pub id: String,
    /// None 表示清除 TTL；Some(秒) 表示从现在起保留。
    #[serde(default)]
    pub ttl_seconds: Option<i64>,
}

/// 清理执行结果。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMaintenanceResult {
    pub staged_files: i64,
    pub orphaned: i64,
    pub expired: i64,
    pub purged: i64,
    pub orphan_blobs: i64,
    pub compacted_packs: i64,
    pub reclaimed_bytes: i64,
    /// 本轮删除的无引用文档块哈希数。
    pub doc_hashes_removed: i64,
    /// 本轮移入 quarantine 的孤儿文件数。
    pub orphan_files: i64,
    /// 本轮清理的过期 quarantine 目录数。
    pub quarantine_removed: i64,
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
    /// 至少被一个节点引用的活跃附件数。
    pub linked_count: i64,
    /// 没有任何节点引用的活跃附件数。
    pub unlinked_count: i64,
    /// 回收站附件数。
    pub trash_count: i64,
    /// 软删除（回收站）附件的逻辑字节数；物理对象仍留在 pack/big 中。
    pub trash_bytes: i64,
    /// storage 目录中可统计的实际文件字节数。
    pub disk_bytes: i64,
    /// 存储所在磁盘剩余字节；无法读取时为 None。
    pub disk_free_bytes: Option<i64>,
    /// 孤儿/回收站/死 pack 的可回收字节估算。
    pub reclaimable_bytes: i64,
    /// 最近一次维护时间（Unix 毫秒）。
    pub last_maintenance_at: Option<i64>,
}

/// 当前工作区的分类磁盘占用（Settings 存储页 IPC 输出）。
///
/// 口径详见 `attachment_service::workspace_storage_stats` 的注释；
/// `trash_bytes` 的物理对象已含在 `attachment_bytes` 内，不计入 `total_bytes` 之外的份额。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStorageStatsDto {
    /// 工作区总字节 = databaseBytes + attachmentBytes + tempBytes + quarantineBytes。
    pub total_bytes: i64,
    /// SQLite 主文件与 `-wal`、`-shm` 伴生文件的字节数。
    pub database_bytes: i64,
    /// 附件物理对象（pack + big）在磁盘上的实际字节数。
    pub attachment_bytes: i64,
    /// 软删除（回收站）附件的逻辑字节数；物理对象仍留在附件字节内。
    pub trash_bytes: i64,
    /// storage/tmp 上传暂存区残留文件字节数。
    pub temp_bytes: i64,
    /// storage/quarantine 孤儿对象隔离区字节数。
    pub quarantine_bytes: i64,
    /// 可回收空间估算（回收站 + 孤儿 + 死 pack 字节）。
    pub reclaimable_bytes: i64,
    /// 存储所在磁盘剩余字节；无法读取时为 None。
    pub disk_free_bytes: Option<i64>,
    /// 最近一次维护时间（Unix 毫秒）；从未执行为 None。
    pub last_maintenance_at: Option<i64>,
}

/// 当前工作区的附件保留策略；默认值与原硬编码一致。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceSettingsDto {
    /// 未关联附件进入可回收状态的宽限天数。
    pub orphan_grace_days: i64,
    /// 回收站附件保留天数。
    pub trash_retention_days: i64,
    /// 上传暂存文件最长保留小时数。
    pub staging_max_age_hours: i64,
}

/// 修改保留策略；字段缺省由前端传完整值。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceSettingsInput {
    pub orphan_grace_days: i64,
    pub trash_retention_days: i64,
    pub staging_max_age_hours: i64,
}
