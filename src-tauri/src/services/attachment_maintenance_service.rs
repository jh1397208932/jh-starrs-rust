//! 附件生命周期维护：孤儿/回收站/TTL、staging 残留、孤儿 blob 与 pack 压缩。
//!
//! 设计原则：
//! - 启动/定时在后台执行，单轮串行于工作区存储锁；
//! - 只做元数据查询与批量更新，不在锁内做 pack 重写；
//! - 单轮失败只记录日志，不阻塞上传、保存或 UI。

use std::collections::BTreeSet;
use std::fs;
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::TransactionBehavior;
use tauri::Manager;

use crate::domain::attachment::{StoragePolicy, TEMP_DIR_RELATIVE};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentBlobRow, AttachmentMaintenanceResult, KIND_BIG, KIND_PACK,
};
use crate::repositories::attachment_repository as repository;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::state::AppState;
use crate::utils::now_ms;

/// 孤儿宽限期：7 天，覆盖编辑器撤销/误删恢复窗口。
pub const ORPHAN_GRACE_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// 回收站保留期：30 天。
pub const TRASH_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;
/// staging 残留最长保留：24 小时。
pub const STAGING_MAX_AGE_MS: i64 = 24 * 60 * 60 * 1000;
/// 看门狗间隔：6 小时。
pub const WATCHDOG_INTERVAL_SECS: u64 = 6 * 60 * 60;
const META_LAST_RUN: &str = "attachment.last_maintenance_at";

/// 可注入的维护窗口；测试用更短时间验证状态迁移。
#[derive(Debug, Clone, Copy)]
pub struct MaintenancePolicy {
    pub orphan_grace_ms: i64,
    pub trash_retention_ms: i64,
    pub staging_max_age_ms: i64,
    pub storage_policy: StoragePolicy,
}

impl Default for MaintenancePolicy {
    fn default() -> Self {
        Self {
            orphan_grace_ms: ORPHAN_GRACE_MS,
            trash_retention_ms: TRASH_RETENTION_MS,
            staging_max_age_ms: STAGING_MAX_AGE_MS,
            storage_policy: StoragePolicy::default(),
        }
    }
}

/// 执行一轮维护；返回真实清理计数。
pub fn run(
    context: &AttachmentContext,
    now: i64,
    policy: MaintenancePolicy,
) -> AppResult<AttachmentMaintenanceResult> {
    let lock = context.lock()?;
    let mut connection = context.connection()?;
    let mut result = AttachmentMaintenanceResult {
        staged_files: cleanup_staging(context, now, policy.staging_max_age_ms)?,
        ..Default::default()
    };

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 兜底认领历史上未标记的孤儿（例如旧版本删除节点留下的引用空洞）。
    result.orphaned +=
        crate::repositories::node_attachment_repository::mark_all_unreferenced(&transaction, now)?
            as i64;
    let orphan_cutoff = now.saturating_sub(policy.orphan_grace_ms);
    for attachment in repository::list_orphaned_before(&transaction, orphan_cutoff)? {
        if repository::mark_deleted(&transaction, &attachment.id, now)? > 0 {
            result.orphaned += 1;
        }
    }
    for attachment in repository::list_expired(&transaction, now)? {
        if repository::mark_deleted(&transaction, &attachment.id, now)? > 0 {
            result.expired += 1;
        }
    }

    let trash_cutoff = now.saturating_sub(policy.trash_retention_ms);
    let mut big_to_remove: Vec<AttachmentBlobRow> = Vec::new();
    let mut packs_to_compact: BTreeSet<String> = BTreeSet::new();
    for attachment in repository::list_trash_before(&transaction, trash_cutoff)? {
        let blob = repository::find_blob(&transaction, &attachment.content_hash)?;
        repository::purge_row(&transaction, &attachment.id)?;
        result.purged += 1;
        if repository::count_hash_rows(&transaction, &attachment.content_hash)? == 0
            && let Some(blob) = blob
        {
            repository::delete_blob(&transaction, &attachment.content_hash)?;
            collect_blob_cleanup(blob, &mut big_to_remove, &mut packs_to_compact);
        }
    }

    // 崩溃可能留下"有 blob 行、无附件行"的对象；统一清掉。
    for blob in repository::list_blobs(&transaction)? {
        if repository::count_hash_rows(&transaction, &blob.hash)? == 0 {
            repository::delete_blob(&transaction, &blob.hash)?;
            result.orphan_blobs += 1;
            collect_blob_cleanup(blob, &mut big_to_remove, &mut packs_to_compact);
        }
    }

    repository::set_meta(&transaction, META_LAST_RUN, &now.to_string())?;
    transaction.commit()?;
    drop(connection);
    drop(lock);

    // 文件删除与 pack 重写必须在锁外执行；compact 自己会重新获取存储锁。
    for blob in big_to_remove {
        if attachment_service::remove_big_object(context, &blob) {
            result.reclaimed_bytes += blob.size.max(0);
        }
    }
    for pack_id in packs_to_compact {
        match attachment_service::compact_pack_if_needed(context, &pack_id, policy.storage_policy) {
            Ok(()) => result.compacted_packs += 1,
            Err(error) => logging::error(
                "attachment",
                &format!("维护压缩 pack 失败 pack={pack_id}: {error}"),
            ),
        }
    }

    logging::info(
        "attachment",
        &format!(
            "附件维护完成 staged={} orphan={} expired={} purged={} orphan_blob={} pack={}",
            result.staged_files,
            result.orphaned,
            result.expired,
            result.purged,
            result.orphan_blobs,
            result.compacted_packs
        ),
    );
    Ok(result)
}

/// 启动一次维护线程；用于工作区新建/切换后补跑。
pub fn spawn_workspace_run(context: AttachmentContext) {
    std::thread::Builder::new()
        .name("attachment-maintenance-once".to_string())
        .spawn(move || {
            if let Err(error) = run(&context, now_ms(), MaintenancePolicy::default()) {
                logging::error("attachment", &format!("工作区维护失败: {error}"));
            }
        })
        .ok();
}

/// 应用级看门狗：启动立即跑一轮，此后每 6 小时一次。
pub fn spawn_watchdog(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("attachment-watchdog".to_string())
        .spawn(move || {
            loop {
                let state = app.state::<AppState>();
                match AttachmentContext::from_state(state.inner()) {
                    Ok(context) => {
                        if let Err(error) = run(&context, now_ms(), MaintenancePolicy::default()) {
                            logging::error("attachment", &format!("看门狗维护失败: {error}"));
                        }
                    }
                    Err(AppError::NoActiveWorkspace) => {}
                    Err(error) => {
                        logging::error("attachment", &format!("看门狗读取工作区失败: {error}"));
                    }
                }
                std::thread::sleep(Duration::from_secs(WATCHDOG_INTERVAL_SECS));
            }
        })
        .ok();
}

fn collect_blob_cleanup(
    blob: AttachmentBlobRow,
    big_to_remove: &mut Vec<AttachmentBlobRow>,
    packs_to_compact: &mut BTreeSet<String>,
) {
    match blob.storage_kind.as_str() {
        KIND_BIG => big_to_remove.push(blob),
        KIND_PACK => {
            if let Some(pack_id) = blob.pack_id {
                packs_to_compact.insert(pack_id);
            }
        }
        _ => logging::error("attachment", "维护遇到未知物理存储类型"),
    }
}

/// 清理 storage/tmp 下超过阈值的普通文件；单文件失败不中断。
fn cleanup_staging(context: &AttachmentContext, now: i64, max_age_ms: i64) -> AppResult<i64> {
    let directory = context.storage_root.join(TEMP_DIR_RELATIVE);
    if !directory.is_dir() {
        return Ok(0);
    }
    let cutoff = now.saturating_sub(max_age_ms);
    let mut removed = 0;
    for entry in fs::read_dir(&directory)? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64);
        let Some(modified) = modified else {
            continue;
        };
        if modified > cutoff {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => removed += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => logging::error(
                "attachment",
                &format!("清理 staging 文件失败 {}: {error}", path.display()),
            ),
        }
    }
    Ok(removed)
}
