//! 附件用例：上传、下载、删除、重命名/移动、校验、统计与 pack compaction。
//!
//! 所有物理临界区使用每工作区存储锁；大文件哈希/复制在锁外完成。附件读写使用
//! `open_existing` 独立连接，不长时间占用主工作区连接。

use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::TransactionBehavior;

use crate::db;
use crate::domain::attachment::{
    StoragePolicy, TEMP_DIR_RELATIVE, big_relative_path, ensure_storage_layout,
    normalize_logical_path, pack_relative_path, resolve_mime, validate_file_name,
};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentBlobRow, AttachmentDeleteResult, AttachmentDto, AttachmentLifecycleInput,
    AttachmentListQuery, AttachmentPackRow, AttachmentRow, AttachmentStatsDto,
    AttachmentVerifyResult, DownloadAttachmentInput, DownloadAttachmentResult, KIND_BIG, KIND_PACK,
    SCOPE_LIBRARY, SCOPE_NODE, STATUS_ACTIVE, STATUS_DELETED, UpdateAttachmentInput,
    UploadAttachmentInput, WorkspaceStorageStatsDto,
};
use crate::repositories::attachment_repository as repository;
use crate::repositories::node_attachment_repository;
use crate::services::attachment_maintenance_service::QUARANTINE_DIR;
use crate::services::attachment_preview_service;
use crate::services::attachment_store::{self, StagedFile};
use crate::services::storage_lock;
use crate::state::AppState;
use crate::utils::{new_id, now_ms};

/// 一次附件操作的上下文：物理/数据库路径 + 进程内锁。
#[derive(Clone)]
pub struct AttachmentContext {
    pub storage_root: PathBuf,
    pub db_path: PathBuf,
    pub lock: Arc<Mutex<()>>,
}

impl AttachmentContext {
    /// 从当前工作区会话读取上下文；不持有会话锁。
    pub fn from_state(state: &AppState) -> AppResult<Self> {
        let guard = state.workspace()?;
        let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
        let workspace_id = session.workspace_id.clone();
        let storage_root = session
            .root_path
            .join(db::paths::WORKSPACE_STORAGE_RELATIVE);
        let db_path = session.db_path.clone();
        let lock = storage_lock::lock_for(&workspace_id);
        Ok(Self {
            storage_root,
            db_path,
            lock,
        })
    }

    /// 打开独立工作区连接；不创建文件、不迁移。
    pub(crate) fn connection(&self) -> AppResult<rusqlite::Connection> {
        db::workspace::open_existing(&self.db_path)
    }

    /// 获取存储锁；锁中毒视为内部状态异常。
    pub(crate) fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, ()>> {
        self.lock.lock().map_err(|_| AppError::Internal)
    }
}

/// 上传附件（生产默认策略）。
pub fn upload(
    context: &AttachmentContext,
    input: UploadAttachmentInput,
) -> AppResult<AttachmentDto> {
    upload_with_policy(context, input, StoragePolicy::default())
}

/// 上传附件；测试可注入更小的阈值。
pub(crate) fn upload_with_policy(
    context: &AttachmentContext,
    input: UploadAttachmentInput,
    policy: StoragePolicy,
) -> AppResult<AttachmentDto> {
    let source = PathBuf::from(&input.source_path);
    if !source.is_absolute() {
        return Err(AppError::validation("源文件路径必须是绝对路径"));
    }
    let raw_name = match input.name {
        Some(name) => name,
        None => source
            .file_name()
            .and_then(|value| value.to_str())
            .map(str::to_string)
            .ok_or_else(|| AppError::validation("无法从源路径取得文件名"))?,
    };
    let name = validate_file_name(&raw_name)?;
    let logical_path = normalize_logical_path(&input.logical_path)?;
    let mime = resolve_mime(input.mime.as_deref(), &name)?;
    let scope = normalize_scope(input.scope.as_deref())?;
    let expires_at = ttl_to_expires_at(input.ttl_seconds, now_ms())?;
    let size = fs::metadata(&source)
        .map_err(|error| {
            logging::error("attachment", &format!("读取源文件元数据失败: {error}"));
            AppError::validation("源文件不存在或不可读取")
        })?
        .len();
    if size > i64::MAX as u64 {
        return Err(AppError::validation("文件过大"));
    }
    ensure_storage_layout(&context.storage_root)?;

    let staged = attachment_store::stage_file(&source, &context.storage_root)?;
    let result = upload_staged(
        context,
        &staged,
        UploadMeta {
            name,
            logical_path,
            mime,
            scope,
            expires_at,
        },
        policy,
    );
    attachment_store::cleanup_staged(&staged.path);
    result
}

/// 上传时写入逻辑附件的元数据；避免上传函数参数膨胀。
struct UploadMeta {
    name: String,
    logical_path: String,
    mime: String,
    scope: String,
    expires_at: Option<i64>,
}

/// 把已暂存并算好哈希的字节登记为附件。
///
/// 模型（2026-10-23 拍板，勿改成"命中即返回已有 id"）：**每次上传都是一条独立的逻辑
/// 记录**——自己的 id、名称、目录与时间；同一 BLAKE3 只有一份物理对象，命中已有 blob
/// 时直接跳过物理写入。物理对象该不该删不靠计数器，而是现场数"还有没有活跃逻辑附件
/// 引用这个哈希"（`count_active_references`），归零才删对象。
fn upload_staged(
    context: &AttachmentContext,
    staged: &StagedFile,
    meta: UploadMeta,
    policy: StoragePolicy,
) -> AppResult<AttachmentDto> {
    let UploadMeta {
        name,
        logical_path,
        mime,
        scope,
        expires_at,
    } = meta;
    if staged.size > i64::MAX as u64 {
        return Err(AppError::validation("文件过大"));
    }
    let size = staged.size as i64;
    let now = now_ms();
    let _lock = context.lock()?;
    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

    let mut published = FileCleanupGuard::default();
    let mut pack_guard: Option<PackAppendGuard> = None;

    let existing_blob = repository::find_blob(&transaction, &staged.hash)?;
    if let Some(blob) = existing_blob {
        if blob.size != size {
            logging::error(
                "attachment",
                "同一 BLAKE3 哈希对应不同大小，物理索引疑似损坏",
            );
            return Err(AppError::Internal);
        }
        // 命中已有对象：不写第二份，直接落一条新的逻辑记录即可。
    } else if policy.is_small(staged.size) {
        let pack = select_or_create_pack(&transaction, size, policy, now)?;
        let indexed_end = repository::max_indexed_end(&transaction, &pack.id)?;
        pack_guard = Some(PackAppendGuard {
            storage_root: context.storage_root.clone(),
            pack_id: pack.id.clone(),
            indexed_end,
            created_pack: pack.created_now,
            armed: true,
        });
        let pack_len =
            attachment_store::append_to_pack(&context.storage_root, &pack.id, staged, indexed_end)?;
        repository::update_pack_size(&transaction, &pack.id, pack_len)?;
        repository::insert_blob(
            &transaction,
            &AttachmentBlobRow {
                hash: staged.hash.clone(),
                size,
                storage_kind: KIND_PACK.to_string(),
                pack_id: Some(pack.id),
                pack_offset: Some(indexed_end),
                created_at: now,
            },
        )?;
    } else {
        let path = attachment_store::publish_big(&context.storage_root, staged)?;
        published = FileCleanupGuard::new(path);
        repository::insert_blob(
            &transaction,
            &AttachmentBlobRow {
                hash: staged.hash.clone(),
                size,
                storage_kind: KIND_BIG.to_string(),
                pack_id: None,
                pack_offset: None,
                created_at: now,
            },
        )?;
    }

    let attachment = AttachmentRow {
        id: new_id(),
        name,
        logical_path,
        content_hash: staged.hash.clone(),
        size,
        mime,
        status: STATUS_ACTIVE.to_string(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
        scope,
        expires_at,
        orphaned_at: None,
        reference_count: 0,
    };
    repository::insert_attachment(&transaction, &attachment)?;
    transaction.commit()?;
    if let Some(guard) = pack_guard.as_mut() {
        guard.disarm();
    }
    published.disarm();
    let dto = attachment.to_dto();
    // 写入时预转换：文本/Markdown/Word 的预览在落库后立刻排队生成并入库，
    // 打开附件页时直接取现成结果，不再现算。
    attachment_preview_service::schedule_precompute(context.clone(), dto.clone());
    Ok(dto)
}

/// 选择活跃 pack；必要时滚动或新建。返回 pack 行与是否本轮新建。
struct PackChoice {
    id: String,
    created_now: bool,
}

fn select_or_create_pack(
    transaction: &rusqlite::Transaction<'_>,
    append_size: i64,
    policy: StoragePolicy,
    now: i64,
) -> AppResult<PackChoice> {
    let mut active = repository::find_active_pack(transaction)?;
    if let Some(pack) = active.as_ref() {
        let projected = pack
            .size
            .checked_add(append_size)
            .ok_or_else(|| AppError::validation("附件过大"))?;
        if projected > policy.pack_roll_bytes as i64 {
            repository::set_pack_active(transaction, &pack.id, false, Some(now))?;
            active = None;
        }
    }
    if let Some(pack) = active {
        return Ok(PackChoice {
            id: pack.id,
            created_now: false,
        });
    }

    let id = new_id();
    let pack = AttachmentPackRow {
        id: id.clone(),
        file_name: format!("{id}.pack"),
        size: 0,
        active: true,
        created_at: now,
        retired_at: None,
    };
    repository::insert_pack(transaction, &pack)?;
    Ok(PackChoice {
        id,
        created_now: true,
    })
}

/// 字节上传上限（粘贴/拖放）；更大的文件应使用路径上传。
pub const MAX_BYTE_UPLOAD: usize = 64 * 1024 * 1024;
/// 图片内嵌预览上限；超过时前端显示损坏态并引导下载。
pub const MAX_PREVIEW_BYTES: i64 = 20 * 1024 * 1024;

/// 上传来自剪贴板/拖放的字节；文档只保存返回的 attachmentId 与展示元数据。
pub fn upload_bytes(
    context: &AttachmentContext,
    name: String,
    logical_path: String,
    mime: Option<String>,
    bytes: Vec<u8>,
) -> AppResult<AttachmentDto> {
    if bytes.len() > MAX_BYTE_UPLOAD {
        return Err(AppError::validation(
            "粘贴/拖放文件超过 64 MiB，请改用“选择文件上传”",
        ));
    }
    let name = validate_file_name(&name)?;
    let logical_path = normalize_logical_path(&logical_path)?;
    let mime = resolve_mime(mime.as_deref(), &name)?;
    // 原始字节只来自编辑器/画板粘贴与拖放，统一按节点附件管理。
    let scope = SCOPE_NODE.to_string();
    ensure_storage_layout(&context.storage_root)?;
    let staged = attachment_store::stage_bytes(&bytes, &context.storage_root)?;
    let result = upload_staged(
        context,
        &staged,
        UploadMeta {
            name,
            logical_path,
            mime,
            scope,
            expires_at: None,
        },
        StoragePolicy::default(),
    );
    attachment_store::cleanup_staged(&staged.path);
    result
}

/// 校验上传作用域；缺省 library，只接受 library/node。
fn normalize_scope(value: Option<&str>) -> AppResult<String> {
    match value.unwrap_or(SCOPE_LIBRARY) {
        SCOPE_LIBRARY => Ok(SCOPE_LIBRARY.to_string()),
        SCOPE_NODE => Ok(SCOPE_NODE.to_string()),
        _ => Err(AppError::validation("附件作用域无效")),
    }
}

/// TTl 秒 → 绝对时间；限制 365 天，避免溢出或永久占用。
fn ttl_to_expires_at(ttl_seconds: Option<i64>, now: i64) -> AppResult<Option<i64>> {
    let Some(seconds) = ttl_seconds else {
        return Ok(None);
    };
    if seconds <= 0 || seconds > 365 * 24 * 60 * 60 {
        return Err(AppError::validation("保留时间需在 1 秒到 365 天之间"));
    }
    let millis = seconds
        .checked_mul(1000)
        .ok_or_else(|| AppError::validation("保留时间无效"))?;
    now.checked_add(millis)
        .map(Some)
        .ok_or_else(|| AppError::validation("保留时间无效"))
}

/// 读取图片附件的原始字节；用于编辑器内嵌预览，限制 20 MiB。
pub fn read_bytes(context: &AttachmentContext, id: &str) -> AppResult<Vec<u8>> {
    read_image_object(context, id, MAX_PREVIEW_BYTES).map(|(_, bytes)| bytes)
}

/// 读取图片对象及其元数据；画板等需要同时拿到 MIME/创建时间的调用方使用。
///
/// 仍走同一套“逻辑附件 → blob 行 → big/pack”读取路径，只把大小上限参数化；
/// 非图片或超限都返回校验错误，由调用方决定是否记为缺失对象。
pub fn read_image_object(
    context: &AttachmentContext,
    id: &str,
    max_bytes: i64,
) -> AppResult<(AttachmentDto, Vec<u8>)> {
    let connection = context.connection()?;
    read_image_object_with(&connection, &context.storage_root, id, max_bytes)
}

/// 用调用方连接读取图片对象：批量读取时复用同一个连接，避免每张图重开库。
pub(crate) fn read_image_object_with(
    connection: &rusqlite::Connection,
    storage_root: &std::path::Path,
    id: &str,
    max_bytes: i64,
) -> AppResult<(AttachmentDto, Vec<u8>)> {
    let attachment = repository::find_active(connection, id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    if !attachment.mime.starts_with("image/") {
        return Err(AppError::validation("此附件不是图片"));
    }
    if attachment.size > max_bytes {
        return Err(AppError::validation("图片过大"));
    }
    let blob = repository::find_blob(connection, &attachment.content_hash)?
        .ok_or_else(|| AppError::not_found("附件内容不存在"))?;
    let mut bytes = Vec::with_capacity(attachment.size.max(0) as usize);
    attachment_store::read_blob(&blob, storage_root, |chunk| {
        bytes.extend_from_slice(chunk);
        Ok(())
    })?;
    Ok((attachment.to_dto(), bytes))
}

/// 删除附件到回收站；物理对象保留以便恢复，由维护任务在保留期后 purge。
pub fn delete(context: &AttachmentContext, id: &str) -> AppResult<AttachmentDeleteResult> {
    let now = now_ms();
    let _lock = context.lock()?;
    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let attachment = repository::find_active(&transaction, id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    if attachment.reference_count > 0 {
        return Err(AppError::conflict(format!(
            "附件仍被 {} 个位置引用，请先解除引用",
            attachment.reference_count
        )));
    }
    if repository::mark_deleted(&transaction, id, now)? == 0 {
        return Err(AppError::not_found("附件不存在或已删除"));
    }
    transaction.commit()?;
    Ok(AttachmentDeleteResult {
        id: id.to_string(),
        content_hash: attachment.content_hash,
        remaining_references: 0,
        physical_deleted: false,
        compaction_scheduled: false,
    })
}

/// 从回收站恢复附件；物理对象已被清理时拒绝恢复。
pub fn restore(context: &AttachmentContext, id: &str) -> AppResult<AttachmentDto> {
    let now = now_ms();
    let _lock = context.lock()?;
    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let attachment =
        repository::find_any(&transaction, id)?.ok_or_else(|| AppError::not_found("附件不存在"))?;
    if attachment.status != STATUS_DELETED {
        return Err(AppError::validation("附件不在回收站"));
    }
    if repository::find_blob(&transaction, &attachment.content_hash)?.is_none() {
        return Err(AppError::conflict("附件内容已被清理，无法恢复"));
    }
    repository::restore(&transaction, id, now)?;
    transaction.commit()?;
    let restored = repository::find_active(&connection, id)?
        .ok_or_else(|| AppError::not_found("附件不存在"))?;
    Ok(restored.to_dto())
}

/// 设置未关联附件的临时保留时间；None 清除。
pub fn set_lifecycle(
    context: &AttachmentContext,
    input: AttachmentLifecycleInput,
) -> AppResult<AttachmentDto> {
    let now = now_ms();
    let expires_at = ttl_to_expires_at(input.ttl_seconds, now)?;
    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let attachment = repository::find_active(&transaction, &input.id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    if attachment.reference_count > 0 && expires_at.is_some() {
        return Err(AppError::conflict("附件仍被引用，不能设置临时保留"));
    }
    repository::set_expires_at(&transaction, &input.id, expires_at, now)?;
    transaction.commit()?;
    repository::find_active(&connection, &input.id)?
        .map(|row| row.to_dto())
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))
}

/// 重命名/移动逻辑附件；只更新元数据。
pub fn update(
    context: &AttachmentContext,
    input: UpdateAttachmentInput,
) -> AppResult<AttachmentDto> {
    if input.name.is_none() && input.logical_path.is_none() {
        return Err(AppError::validation("没有需要修改的内容"));
    }
    let name = input.name.as_deref().map(validate_file_name).transpose()?;
    let logical_path = input
        .logical_path
        .as_deref()
        .map(normalize_logical_path)
        .transpose()?;

    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = repository::find_active(&transaction, &input.id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    let target_name = name.unwrap_or_else(|| current.name.clone());
    let target_path = logical_path.unwrap_or_else(|| current.logical_path.clone());
    repository::update_attachment_meta(
        &transaction,
        &input.id,
        Some(&target_name),
        Some(&target_path),
        now_ms(),
    )?;
    transaction.commit()?;
    let updated = repository::find_active(&connection, &input.id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    Ok(updated.to_dto())
}

/// 列出附件。
pub fn list(
    context: &AttachmentContext,
    query: &AttachmentListQuery,
) -> AppResult<Vec<AttachmentDto>> {
    let normalized = query
        .logical_path
        .as_deref()
        .map(normalize_logical_path)
        .transpose()?;
    let query = AttachmentListQuery {
        logical_path: normalized,
        include_deleted: query.include_deleted,
        search: query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| {
                format!(
                    "%{}%",
                    value
                        .replace('\\', "\\\\")
                        .replace('%', "\\%")
                        .replace('_', "\\_")
                )
            }),
        limit: Some(query.limit.unwrap_or(50).clamp(1, 200)),
        offset: Some(query.offset.unwrap_or(0).max(0)),
    };
    let connection = context.connection()?;
    let rows = repository::list(&connection, &query)?;
    Ok(rows.into_iter().map(|row| row.to_dto()).collect())
}

/// 按附件节点 id 读取其唯一对象。
pub fn get_by_node(context: &AttachmentContext, node_id: &str) -> AppResult<AttachmentDto> {
    let connection = context.connection()?;
    let object_id = node_attachment_repository::first_object_id(&connection, node_id)?
        .ok_or_else(|| AppError::not_found("附件不存在"))?;
    repository::find_active(&connection, &object_id)?
        .map(|row| row.to_dto())
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))
}

/// 读取单条活跃附件。
pub fn get(context: &AttachmentContext, id: &str) -> AppResult<AttachmentDto> {
    let connection = context.connection()?;
    repository::find_active(&connection, id)?
        .map(|row| row.to_dto())
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))
}

/// 流式下载到目标路径。
pub fn download(
    context: &AttachmentContext,
    input: DownloadAttachmentInput,
) -> AppResult<DownloadAttachmentResult> {
    let connection = context.connection()?;
    let attachment = repository::find_active(&connection, &input.id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    let blob = repository::find_blob(&connection, &attachment.content_hash)?
        .ok_or_else(|| AppError::not_found("附件内容不存在"))?;
    let destination = PathBuf::from(&input.dest_path);
    let size = attachment_store::download_to_path(
        &blob,
        &context.storage_root,
        &destination,
        input.overwrite,
    )?;
    Ok(DownloadAttachmentResult {
        path: destination.to_string_lossy().into_owned(),
        size: size as i64,
    })
}

/// 流式校验附件内容。
pub fn verify(context: &AttachmentContext, id: &str) -> AppResult<AttachmentVerifyResult> {
    let connection = context.connection()?;
    let attachment = repository::find_active(&connection, id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    let blob = repository::find_blob(&connection, &attachment.content_hash)?
        .ok_or_else(|| AppError::not_found("附件内容不存在"))?;
    match attachment_store::verify_blob(&blob, &context.storage_root) {
        Ok((actual_size, actual_hash)) => {
            let valid = actual_size == blob.size as u64 && actual_hash == blob.hash;
            Ok(AttachmentVerifyResult {
                id: attachment.id,
                content_hash: attachment.content_hash,
                expected_size: blob.size,
                actual_size: actual_size as i64,
                valid,
                message: if valid {
                    None
                } else {
                    Some("内容哈希或大小与元数据不一致".to_string())
                },
            })
        }
        Err(error) => {
            logging::error("attachment", &format!("校验附件失败: {error}"));
            Ok(AttachmentVerifyResult {
                id: attachment.id,
                content_hash: attachment.content_hash,
                expected_size: blob.size,
                actual_size: 0,
                valid: false,
                message: Some("无法读取物理对象，可能已损坏".to_string()),
            })
        }
    }
}

/// 附件与物理对象统计。
pub fn stats(context: &AttachmentContext) -> AppResult<AttachmentStatsDto> {
    let connection = context.connection()?;
    let stats = repository::stats(&connection)?;

    let mut pack_disk_bytes = 0_i64;
    let mut dead_pack_bytes = 0_i64;
    for pack in repository::list_packs(&connection)? {
        let actual = pack_file_size(context, &pack.id).unwrap_or(pack.size.max(0) as u64);
        let live = repository::live_bytes_in_pack(&connection, &pack.id)?.max(0) as u64;
        pack_disk_bytes += actual as i64;
        dead_pack_bytes += actual.saturating_sub(live) as i64;
    }
    let mut big_disk_bytes = 0_i64;
    for blob in repository::list_blobs(&connection)? {
        if blob.storage_kind != KIND_BIG {
            continue;
        }
        let Ok(relative) = big_relative_path(&blob.hash) else {
            continue;
        };
        if let Ok(metadata) = fs::metadata(context.storage_root.join(relative)) {
            big_disk_bytes += metadata.len() as i64;
        }
    }
    let last_maintenance_at = repository::get_meta(&connection, "attachment.last_maintenance_at")?
        .and_then(|value| value.parse::<i64>().ok());
    let reclaimable_bytes = stats.trash_bytes + stats.orphan_bytes + dead_pack_bytes;
    Ok(AttachmentStatsDto {
        active_count: stats.active_count,
        deleted_count: stats.deleted_count,
        logical_bytes: stats.logical_bytes,
        unique_objects: stats.unique_objects,
        physical_bytes: stats.physical_bytes,
        big_objects: stats.big_objects,
        pack_objects: stats.pack_objects,
        pack_count: stats.pack_count,
        pack_bytes: stats.pack_bytes,
        dead_pack_bytes,
        linked_count: stats.linked_count,
        unlinked_count: stats.unlinked_count,
        trash_count: stats.trash_count,
        trash_bytes: stats.trash_bytes,
        disk_bytes: pack_disk_bytes + big_disk_bytes,
        disk_free_bytes: storage_free_bytes(&context.storage_root),
        reclaimable_bytes,
        last_maintenance_at,
    })
}

/// 存储所在磁盘剩余字节；非 Unix 平台返回 None。
fn storage_free_bytes(path: &std::path::Path) -> Option<i64> {
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let path = CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
            return None;
        }
        i64::try_from(stat.f_bavail as u64 * stat.f_frsize as u64).ok()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// 工作区存储统计的递归遍历深度上限；防止损坏的超深目录树拖垮统计调用。
const STATS_WALK_MAX_DEPTH: usize = 16;
/// 单次统计允许访问的目录条目上限；超出即停止，保证调用有界返回。
const STATS_WALK_MAX_ENTRIES: usize = 50_000;

/// 当前工作区的分类磁盘占用（Settings 存储页）。
///
/// 口径约定：
/// - `attachment_bytes` 复用 [`stats`]（pack 与 big 对象实际文件长度），不重复扫描 objects 目录；
/// - 软删除附件的物理对象仍留在 pack/big 文件内，因此 `trash_bytes`（逻辑字节）已被
///   `attachment_bytes` 覆盖，`total_bytes` 不再单独加它，避免双重计数；
/// - `temp_bytes`（storage/tmp 上传暂存区）与 `quarantine_bytes`（storage/quarantine 隔离区）
///   是 objects 之外的独立子目录，按真实文件递归统计后计入 `total_bytes`；
/// - `total_bytes` = database_bytes + attachment_bytes + temp_bytes + quarantine_bytes。
pub fn workspace_storage_stats(context: &AttachmentContext) -> AppResult<WorkspaceStorageStatsDto> {
    let attachment = stats(context)?;
    // 暂存区与隔离区共享同一条目预算，保证整次调用的遍历规模有界。
    let mut entry_budget = STATS_WALK_MAX_ENTRIES;
    let temp_bytes = dir_files_bytes(
        &context.storage_root.join(TEMP_DIR_RELATIVE),
        &mut entry_budget,
    );
    let quarantine_bytes = dir_files_bytes(
        &context.storage_root.join(QUARANTINE_DIR),
        &mut entry_budget,
    );
    let database_bytes = database_file_bytes(&context.db_path);
    let total_bytes = database_bytes
        .saturating_add(attachment.disk_bytes)
        .saturating_add(temp_bytes)
        .saturating_add(quarantine_bytes);
    Ok(WorkspaceStorageStatsDto {
        total_bytes,
        database_bytes,
        attachment_bytes: attachment.disk_bytes,
        trash_bytes: attachment.trash_bytes,
        temp_bytes,
        quarantine_bytes,
        reclaimable_bytes: attachment.reclaimable_bytes,
        disk_free_bytes: attachment.disk_free_bytes,
        last_maintenance_at: attachment.last_maintenance_at,
    })
}

/// 递归统计目录下普通文件的实际字节数。
///
/// 目录缺失或不可读按 0 处理；单个条目错误直接忽略，不让整个统计失败。
/// 符号链接（Unix 下 `entry.metadata()` 走 lstat）既不计入也不下钻，
/// 配合深度与条目数上限，保证损坏/异常目录树不会让调用失控。
fn dir_files_bytes(root: &std::path::Path, entry_budget: &mut usize) -> i64 {
    let mut total = 0_i64;
    let mut pending: Vec<(PathBuf, usize)> = vec![(root.to_path_buf(), 0)];
    while let Some((directory, depth)) = pending.pop() {
        if *entry_budget == 0 {
            break;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if *entry_budget == 0 {
                break;
            }
            *entry_budget -= 1;
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_file() {
                total = total.saturating_add(i64::try_from(metadata.len()).unwrap_or(i64::MAX));
            } else if metadata.is_dir() && depth < STATS_WALK_MAX_DEPTH {
                pending.push((entry.path(), depth + 1));
            }
        }
    }
    total
}

/// 数据库字节：SQLite 主文件与其 `-wal`、`-shm` 伴生文件；缺失的文件按 0 计。
fn database_file_bytes(db_path: &std::path::Path) -> i64 {
    let mut paths: Vec<PathBuf> = vec![db_path.to_path_buf()];
    if let Some(file_name) = db_path.file_name().and_then(|value| value.to_str()) {
        let parent = db_path.parent().unwrap_or(db_path);
        for suffix in ["-wal", "-shm"] {
            paths.push(parent.join(format!("{file_name}{suffix}")));
        }
    }
    let mut total = 0_i64;
    for path in paths {
        if let Ok(metadata) = fs::metadata(&path)
            && metadata.is_file()
        {
            total = total.saturating_add(i64::try_from(metadata.len()).unwrap_or(i64::MAX));
        }
    }
    total
}

/// 后台 compaction 入口；可重入地检查 pack 是否仍有压缩价值。
pub(crate) fn compact_pack_if_needed(
    context: &AttachmentContext,
    pack_id: &str,
    policy: StoragePolicy,
) -> AppResult<()> {
    let _lock = context.lock()?;
    let mut connection = context.connection()?;
    let Some(pack) = repository::find_pack(&connection, pack_id)? else {
        return Ok(());
    };
    let current_size = pack_file_size(context, pack_id).unwrap_or(pack.size.max(0) as u64);
    let current_live = repository::live_bytes_in_pack(&connection, pack_id)?.max(0) as u64;
    if !policy.should_compact(current_size, current_live) {
        return Ok(());
    }

    // 先让旧 pack 停止接收新对象；若它仍是 active，创建一个新的 active pack。
    if pack.active {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        repository::set_pack_active(&transaction, pack_id, false, Some(now_ms()))?;
        let new_id = new_id();
        repository::insert_pack(
            &transaction,
            &AttachmentPackRow {
                id: new_id.clone(),
                file_name: format!("{new_id}.pack"),
                size: 0,
                active: true,
                created_at: now_ms(),
                retired_at: None,
            },
        )?;
        transaction.commit()?;
    }

    let live_blobs = repository::list_live_blobs_in_pack(&connection, pack_id)?;
    if live_blobs.is_empty() {
        retire_pack_row_and_file(context, pack_id)?;
        return Ok(());
    }

    let new_pack_id = new_id();
    let new_pack_path = context.storage_root.join(pack_relative_path(&new_pack_id)?);
    if let Some(parent) = new_pack_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut new_file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&new_pack_path)?;
    let mut new_pack_guard = FileCleanupGuard::new(new_pack_path.clone());
    let mut new_offsets = Vec::with_capacity(live_blobs.len());
    let mut written = 0_i64;
    let copy_result = (|| -> AppResult<()> {
        for blob in &live_blobs {
            let offset = written;
            let copied = attachment_store::read_blob(blob, &context.storage_root, |chunk| {
                std::io::Write::write_all(&mut new_file, chunk)?;
                Ok(())
            })?;
            if copied != blob.size.max(0) as u64 {
                return Err(AppError::Internal);
            }
            written += copied as i64;
            new_offsets.push((
                blob.hash.clone(),
                blob.pack_id.clone(),
                blob.pack_offset,
                offset,
            ));
        }
        std::io::Write::flush(&mut new_file)?;
        new_file.sync_all()?;
        Ok(())
    })();
    drop(new_file);
    copy_result?;

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 必须先插入新 pack 行，再更新 blob 的 pack_id；否则外键在更新时找不到目标行。
    repository::insert_pack(
        &transaction,
        &AttachmentPackRow {
            id: new_pack_id.clone(),
            file_name: format!("{new_pack_id}.pack"),
            size: written,
            active: false,
            created_at: now_ms(),
            retired_at: None,
        },
    )?;
    let mut moved = 0_i64;
    for (hash, old_pack_id, old_offset, new_offset) in &new_offsets {
        let Some(old_pack_id) = old_pack_id.as_deref() else {
            continue;
        };
        let Some(old_offset) = old_offset else {
            continue;
        };
        if repository::move_blob_to_pack(
            &transaction,
            hash,
            old_pack_id,
            *old_offset,
            &new_pack_id,
            *new_offset,
        )? {
            moved += 1;
        }
    }
    if moved == 0 {
        transaction.rollback()?;
        return Ok(());
    }
    let remaining = repository::count_blobs_in_pack(&transaction, pack_id)?;
    let remove_old = remaining == 0;
    if remove_old {
        repository::delete_pack(&transaction, pack_id)?;
    }
    transaction.commit()?;
    new_pack_guard.disarm();

    if remove_old {
        let old_path = context.storage_root.join(pack_relative_path(pack_id)?);
        if let Err(error) = fs::remove_file(&old_path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            logging::error("attachment", &format!("删除旧 pack 失败: {error}"));
        }
    }

    let live_new = repository::live_bytes_in_pack(&connection, &new_pack_id)?;
    if policy.should_compact(written.max(0) as u64, live_new.max(0) as u64) {
        logging::info(
            "attachment",
            &format!("新 pack {new_pack_id} 仍有较多死字节，等待后续 compaction"),
        );
    }
    Ok(())
}

fn retire_pack_row_and_file(context: &AttachmentContext, pack_id: &str) -> AppResult<()> {
    let mut connection = context.connection()?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let removable = repository::count_blobs_in_pack(&transaction, pack_id)? == 0;
    if removable {
        repository::delete_pack(&transaction, pack_id)?;
    }
    transaction.commit()?;
    if !removable {
        return Ok(());
    }
    let path = context.storage_root.join(pack_relative_path(pack_id)?);
    if let Err(error) = fs::remove_file(&path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        logging::error("attachment", &format!("删除空 pack 失败: {error}"));
    }
    Ok(())
}

pub(crate) fn remove_big_object(context: &AttachmentContext, blob: &AttachmentBlobRow) -> bool {
    let Ok(relative) = big_relative_path(&blob.hash) else {
        logging::error("attachment", "big 对象哈希格式无效");
        return false;
    };
    let path = context.storage_root.join(relative);
    match fs::remove_file(&path) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            logging::error("attachment", &format!("删除 big 对象失败: {error}"));
            false
        }
    }
}

pub(crate) fn pack_file_size(context: &AttachmentContext, pack_id: &str) -> Option<u64> {
    let path = context.storage_root.join(pack_relative_path(pack_id).ok()?);
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

/// 新建物理文件的失败清理守卫；成功提交后 disarm。
#[derive(Default)]
struct FileCleanupGuard {
    path: Option<PathBuf>,
    armed: bool,
}

impl FileCleanupGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path: Some(path),
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
        self.path = None;
    }
}

impl Drop for FileCleanupGuard {
    fn drop(&mut self) {
        if self.armed
            && let Some(path) = self.path.take()
            && let Err(error) = fs::remove_file(&path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            logging::error("attachment", &format!("回滚 big 文件失败: {error}"));
        }
    }
}

/// pack 追加失败时截断/删除新 pack 的守卫。
struct PackAppendGuard {
    storage_root: PathBuf,
    pack_id: String,
    indexed_end: i64,
    created_pack: bool,
    armed: bool,
}

impl PackAppendGuard {
    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for PackAppendGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Err(error) = attachment_store::rollback_pack_append(
            &self.storage_root,
            &self.pack_id,
            self.indexed_end,
        ) {
            logging::error("attachment", &format!("回滚 pack 追加失败: {error}"));
        }
        if self.created_pack
            && let Ok(relative) = pack_relative_path(&self.pack_id)
        {
            let _ = fs::remove_file(self.storage_root.join(relative));
        }
    }
}
