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
    StoragePolicy, big_relative_path, ensure_storage_layout, normalize_logical_path,
    pack_relative_path, resolve_mime, validate_file_name,
};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentBlobRow, AttachmentDeleteResult, AttachmentDto, AttachmentListQuery,
    AttachmentPackRow, AttachmentRow, AttachmentStatsDto, AttachmentVerifyResult,
    DownloadAttachmentInput, DownloadAttachmentResult, KIND_BIG, KIND_PACK, STATUS_ACTIVE,
    UpdateAttachmentInput, UploadAttachmentInput,
};
use crate::repositories::attachment_repository as repository;
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
    fn connection(&self) -> AppResult<rusqlite::Connection> {
        db::workspace::open_existing(&self.db_path)
    }

    /// 获取存储锁；锁中毒视为内部状态异常。
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, ()>> {
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
    let size = fs::metadata(&source)
        .map_err(|error| {
            logging::error("attachment", &format!("读取源文件元数据失败: {error}"));
            AppError::validation("源文件不存在或不可读取")
        })?
        .len();
    if size > i64::MAX as u64 {
        return Err(AppError::validation("文件过大，超出本地存储支持范围"));
    }
    ensure_storage_layout(&context.storage_root)?;

    let staged = attachment_store::stage_file(&source, &context.storage_root)?;
    let result = upload_staged(context, &staged, name, logical_path, mime, policy);
    attachment_store::cleanup_staged(&staged.path);
    result
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
    name: String,
    logical_path: String,
    mime: String,
    policy: StoragePolicy,
) -> AppResult<AttachmentDto> {
    if staged.size > i64::MAX as u64 {
        return Err(AppError::validation("文件过大，超出本地存储支持范围"));
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
    };
    repository::insert_attachment(&transaction, &attachment)?;
    transaction.commit()?;
    if let Some(guard) = pack_guard.as_mut() {
        guard.disarm();
    }
    published.disarm();
    Ok(attachment.to_dto())
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
            .ok_or_else(|| AppError::validation("附件大小超出支持范围"))?;
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
    ensure_storage_layout(&context.storage_root)?;
    let staged = attachment_store::stage_bytes(&bytes, &context.storage_root)?;
    let result = upload_staged(
        context,
        &staged,
        name,
        logical_path,
        mime,
        StoragePolicy::default(),
    );
    attachment_store::cleanup_staged(&staged.path);
    result
}

/// 读取图片附件的原始字节；用于编辑器内嵌预览，限制大小并校验 MIME。
pub fn read_bytes(context: &AttachmentContext, id: &str) -> AppResult<Vec<u8>> {
    let connection = context.connection()?;
    let attachment = repository::find_active(&connection, id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    if !attachment.mime.starts_with("image/") {
        return Err(AppError::validation("该附件不是图片，无法生成图片预览"));
    }
    if attachment.size > MAX_PREVIEW_BYTES {
        return Err(AppError::validation(
            "图片超过 20 MiB，无法内嵌预览，请下载原图",
        ));
    }
    let blob = repository::find_blob(&connection, &attachment.content_hash)?
        .ok_or_else(|| AppError::not_found("附件物理对象不存在"))?;
    let mut bytes = Vec::with_capacity(attachment.size.max(0) as usize);
    attachment_store::read_blob(&blob, &context.storage_root, |chunk| {
        bytes.extend_from_slice(chunk);
        Ok(())
    })?;
    Ok(bytes)
}

/// 删除附件；物理删除与 compaction 调度在事务提交后执行。
pub fn delete(context: &AttachmentContext, id: &str) -> AppResult<AttachmentDeleteResult> {
    delete_with_policy(context, id, StoragePolicy::default())
}

pub(crate) fn delete_with_policy(
    context: &AttachmentContext,
    id: &str,
    policy: StoragePolicy,
) -> AppResult<AttachmentDeleteResult> {
    let now = now_ms();
    let mut compact_pack_id = None;
    let result = {
        let _lock = context.lock()?;
        let mut connection = context.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let attachment = repository::find_active(&transaction, id)?
            .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
        if repository::mark_deleted(&transaction, id, now)? == 0 {
            return Err(AppError::not_found("附件不存在或已删除"));
        }

        let mut remaining = 0_i64;
        let mut big_to_remove: Option<AttachmentBlobRow> = None;
        if attachment.content_hash.is_empty() {
            logging::error("attachment", "附件缺少内容哈希");
        } else if let Some(blob) = repository::find_blob(&transaction, &attachment.content_hash)? {
            // 物理对象该不该留，只看还有没有其他活跃记录引用同一哈希——不需要计数器。
            remaining =
                repository::count_active_references(&transaction, &attachment.content_hash)?;
            if remaining == 0 {
                repository::delete_blob(&transaction, &attachment.content_hash)?;
                match blob.storage_kind.as_str() {
                    KIND_BIG => big_to_remove = Some(blob),
                    KIND_PACK => {
                        if let Some(pack_id) = blob.pack_id.as_deref() {
                            let pack_size = pack_file_size(context, pack_id).unwrap_or(0);
                            let live = repository::live_bytes_in_pack(&transaction, pack_id)?;
                            if policy.should_compact(pack_size, live.max(0) as u64) {
                                compact_pack_id = Some(pack_id.to_string());
                            }
                        }
                    }
                    _ => {
                        logging::error("attachment", "物理对象存储类型未知");
                    }
                }
            }
        }

        // 物理删除必须在事务提交后执行，否则回滚会留下“有索引无文件”的损坏状态。
        transaction.commit()?;
        let physical_deleted = big_to_remove
            .as_ref()
            .is_some_and(|blob| remove_big_object(context, blob));
        AttachmentDeleteResult {
            id: id.to_string(),
            content_hash: attachment.content_hash,
            remaining_references: remaining,
            physical_deleted,
            compaction_scheduled: compact_pack_id.is_some(),
        }
    };

    if let Some(pack_id) = compact_pack_id {
        schedule_compaction(context.clone(), pack_id, policy);
    }
    Ok(result)
}

/// 重命名/移动逻辑附件；只更新元数据。
pub fn update(
    context: &AttachmentContext,
    input: UpdateAttachmentInput,
) -> AppResult<AttachmentDto> {
    if input.name.is_none() && input.logical_path.is_none() {
        return Err(AppError::validation("至少提供新的文件名或逻辑目录"));
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
    };
    let connection = context.connection()?;
    let rows = repository::list(&connection, &query)?;
    Ok(rows.into_iter().map(|row| row.to_dto()).collect())
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
        .ok_or_else(|| AppError::not_found("附件物理对象不存在"))?;
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
        .ok_or_else(|| AppError::not_found("附件物理对象不存在"))?;
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
        dead_pack_bytes: stats.dead_pack_bytes,
    })
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

fn schedule_compaction(context: AttachmentContext, pack_id: String, policy: StoragePolicy) {
    let thread_name = format!("starris-pack-{}", &pack_id[..pack_id.len().min(8)]);
    let spawn = std::thread::Builder::new()
        .name(thread_name)
        .spawn(move || {
            if let Err(error) = compact_pack_if_needed(&context, &pack_id, policy) {
                logging::error("attachment", &format!("后台 pack compaction 失败: {error}"));
            }
        });
    if let Err(error) = spawn {
        logging::error("attachment", &format!("启动 compaction 线程失败: {error}"));
    }
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

fn remove_big_object(context: &AttachmentContext, blob: &AttachmentBlobRow) -> bool {
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

fn pack_file_size(context: &AttachmentContext, pack_id: &str) -> Option<u64> {
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

/// 后台调用 compaction 的测试入口；避免集成测试自行拼装私有上下文。
#[cfg(test)]
pub fn compact_for_test(
    context: &AttachmentContext,
    pack_id: &str,
    policy: StoragePolicy,
) -> AppResult<()> {
    compact_pack_if_needed(context, pack_id, policy)
}
