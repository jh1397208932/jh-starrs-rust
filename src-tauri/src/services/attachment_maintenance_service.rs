//! 附件生命周期维护：孤儿/回收站/TTL、staging 残留、孤儿 blob 与 pack 压缩。
//!
//! 设计原则：
//! - 启动/定时在后台执行，单轮串行于工作区存储锁；
//! - 只做元数据查询与批量更新，不在锁内做 pack 重写；
//! - 单轮失败只记录日志，不阻塞上传、保存或 UI。

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

use rusqlite::{Connection, TransactionBehavior};
use tauri::Manager;

use crate::domain::attachment::{StoragePolicy, TEMP_DIR_RELATIVE};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentBlobRow, AttachmentMaintenanceResult, KIND_BIG, KIND_PACK, MaintenanceSettingsDto,
    MaintenanceSettingsInput,
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
/// 孤儿文件最短年龄：24 小时，避开正在发布的对象。
const ORPHAN_FILE_MIN_AGE_MS: i64 = 24 * 60 * 60 * 1000;
/// quarantine 保留期：7 天。
const QUARANTINE_RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;
/// quarantine 目录名；存储统计（workspace_storage_stats）复用同一定义。
pub(crate) const QUARANTINE_DIR: &str = "quarantine";
const META_LAST_RUN: &str = "attachment.last_maintenance_at";
const META_ORPHAN_GRACE_DAYS: &str = "attachment.orphan_grace_days";
const META_TRASH_RETENTION_DAYS: &str = "attachment.trash_retention_days";
const META_STAGING_HOURS: &str = "attachment.staging_max_age_hours";
const DEFAULT_ORPHAN_GRACE_DAYS: i64 = 7;
const DEFAULT_TRASH_RETENTION_DAYS: i64 = 30;
const DEFAULT_STAGING_MAX_AGE_HOURS: i64 = 24;

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

fn read_days(connection: &Connection, key: &str, fallback: i64) -> AppResult<i64> {
    let value = repository::get_meta(connection, key)?
        .and_then(|raw| raw.parse::<i64>().ok())
        .filter(|value| *value > 0);
    Ok(value.unwrap_or(fallback))
}

fn read_settings(connection: &Connection) -> AppResult<MaintenanceSettingsDto> {
    Ok(MaintenanceSettingsDto {
        orphan_grace_days: read_days(
            connection,
            META_ORPHAN_GRACE_DAYS,
            DEFAULT_ORPHAN_GRACE_DAYS,
        )?,
        trash_retention_days: read_days(
            connection,
            META_TRASH_RETENTION_DAYS,
            DEFAULT_TRASH_RETENTION_DAYS,
        )?,
        staging_max_age_hours: read_days(
            connection,
            META_STAGING_HOURS,
            DEFAULT_STAGING_MAX_AGE_HOURS,
        )?,
    })
}

/// 读取当前工作区的保留策略。
pub fn settings(context: &AttachmentContext) -> AppResult<MaintenanceSettingsDto> {
    let connection = context.connection()?;
    read_settings(&connection)
}

/// 保存当前工作区的保留策略；范围与前端一致，越界直接拒绝。
pub fn update_settings(
    context: &AttachmentContext,
    input: MaintenanceSettingsInput,
) -> AppResult<MaintenanceSettingsDto> {
    if !(1..=365).contains(&input.orphan_grace_days) {
        return Err(AppError::validation("孤儿保留天数需在 1–365 之间"));
    }
    if !(1..=365).contains(&input.trash_retention_days) {
        return Err(AppError::validation("回收站保留天数需在 1–365 之间"));
    }
    if !(1..=168).contains(&input.staging_max_age_hours) {
        return Err(AppError::validation("暂存保留小时数需在 1–168 之间"));
    }
    let _lock = context.lock()?;
    let connection = context.connection()?;
    repository::set_meta(
        &connection,
        META_ORPHAN_GRACE_DAYS,
        &input.orphan_grace_days.to_string(),
    )?;
    repository::set_meta(
        &connection,
        META_TRASH_RETENTION_DAYS,
        &input.trash_retention_days.to_string(),
    )?;
    repository::set_meta(
        &connection,
        META_STAGING_HOURS,
        &input.staging_max_age_hours.to_string(),
    )?;
    read_settings(&connection)
}

/// 按工作区配置构造维护策略；配置缺失时回退默认值。
pub fn load_policy(context: &AttachmentContext) -> AppResult<MaintenancePolicy> {
    let connection = context.connection()?;
    let settings = read_settings(&connection)?;
    Ok(MaintenancePolicy {
        orphan_grace_ms: settings.orphan_grace_days * 24 * 60 * 60 * 1000,
        trash_retention_ms: settings.trash_retention_days * 24 * 60 * 60 * 1000,
        staging_max_age_ms: settings.staging_max_age_hours * 60 * 60 * 1000,
        storage_policy: StoragePolicy::default(),
    })
}

/// 执行一轮完整维护（看门狗与工作区补跑使用）；含 pack 重写。
pub fn run(
    context: &AttachmentContext,
    now: i64,
    policy: MaintenancePolicy,
) -> AppResult<AttachmentMaintenanceResult> {
    run_impl(context, now, policy, true)
}

/// 设置 → 存储「立即清理」使用的一轮维护：只回收无用数据。
///
/// 与 [`run`] 的差别是不做 pack 重写。重写会把仍在使用对象的数据搬到新文件并改
/// `attachment_blob` 偏移，虽然内容不变，但界面上承诺了「正在使用的附件不会被改动」，
/// 所以手动入口不做；空间回收交给后台看门狗。
pub fn run_manual(
    context: &AttachmentContext,
    now: i64,
    policy: MaintenancePolicy,
) -> AppResult<AttachmentMaintenanceResult> {
    run_impl(context, now, policy, false)
}

/// `compact_live_packs` 为 false 时跳过 pack 重写，其余判据完全一致。
fn run_impl(
    context: &AttachmentContext,
    now: i64,
    policy: MaintenancePolicy,
    compact_live_packs: bool,
) -> AppResult<AttachmentMaintenanceResult> {
    let lock = context.lock()?;
    let mut connection = context.connection()?;
    let mut result = AttachmentMaintenanceResult {
        staged_files: cleanup_staging(context, now, policy.staging_max_age_ms)?,
        ..Default::default()
    };

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // 崩溃可能在两步之间退出，留下"有附件行、无引用行"的对象；统一认领为孤儿，
    // 超过宽限期后回收，避免这类对象永久占用磁盘。
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

    // 删除节点/知识库只级联删 doc_block_tree，hash 表没有外键；在维护任务里统一回收。
    result.doc_hashes_removed = transaction.execute(
        "DELETE FROM doc_block_hash
         WHERE NOT EXISTS (
             SELECT 1 FROM doc_block_tree t WHERE t.hash = doc_block_hash.hash
         )",
        [],
    )? as i64;

    repository::set_meta(&transaction, META_LAST_RUN, &now.to_string())?;
    transaction.commit()?;

    // big 对象的 unlink 必须在存储锁内完成：上传在同一把锁内发布同哈希文件，
    // 若先释放锁再删文件，可能删掉刚发布的物理对象，留下悬空 blob 行。
    for blob in big_to_remove {
        match repository::find_blob(&connection, &blob.hash) {
            Ok(Some(_)) => continue,
            Ok(None) => {}
            Err(error) => {
                logging::error(
                    "attachment",
                    &format!("维护重查 big 对象失败 hash={}: {error}", blob.hash),
                );
                continue;
            }
        }
        if attachment_service::remove_big_object(context, &blob) {
            result.reclaimed_bytes += blob.size.max(0);
        }
    }
    // 扫描 objects 下没有 DB 行的文件；移动失败只记录并保留原文件。
    match scan_orphan_files(&connection, context, now) {
        Ok((orphan_files, quarantine_removed)) => {
            result.orphan_files = orphan_files;
            result.quarantine_removed = quarantine_removed;
        }
        Err(error) => logging::error("attachment", &format!("孤儿文件扫描失败: {error}")),
    }
    drop(connection);
    drop(lock);

    // pack 重写会自行获取存储锁，必须在锁外执行。
    if compact_live_packs {
        for pack_id in packs_to_compact {
            match attachment_service::compact_pack_if_needed(
                context,
                &pack_id,
                policy.storage_policy,
            ) {
                Ok(()) => result.compacted_packs += 1,
                Err(error) => logging::error(
                    "attachment",
                    &format!("维护压缩 pack 失败 pack={pack_id}: {error}"),
                ),
            }
        }
    }

    logging::info(
        "attachment",
        &format!(
            "附件维护完成 staged={} orphan={} expired={} purged={} orphan_blob={} pack={} doc_hash={} orphan_file={} quarantine={}",
            result.staged_files,
            result.orphaned,
            result.expired,
            result.purged,
            result.orphan_blobs,
            result.compacted_packs,
            result.doc_hashes_removed,
            result.orphan_files,
            result.quarantine_removed
        ),
    );
    Ok(result)
}

/// 维护请求调度：记住“最新一次请求的工作区”，单消费者按最新请求补跑。
///
/// 以前用两个全局 bool 表示 pending/running：切换工作区时新上下文会被丢掉，
/// 消费者只会在旧工作区上白跑一轮，新工作区要等下次切换或 6 小时看门狗才维护。
#[cfg(not(test))]
struct MaintenanceSchedule {
    running: bool,
    pending: Option<AttachmentContext>,
}

#[cfg(not(test))]
impl MaintenanceSchedule {
    /// 登记一次请求；返回 true 表示调用方需要启动消费者线程。
    fn request(&mut self, context: AttachmentContext) -> bool {
        self.pending = Some(context);
        if self.running {
            return false;
        }
        self.running = true;
        true
    }

    /// 取下一轮请求；没有请求时把 running 置回 false 并返回 None。
    fn take(&mut self) -> Option<AttachmentContext> {
        if let Some(context) = self.pending.take() {
            return Some(context);
        }
        self.running = false;
        None
    }
}

#[cfg(not(test))]
static MAINTENANCE_SCHEDULE: std::sync::Mutex<MaintenanceSchedule> =
    std::sync::Mutex::new(MaintenanceSchedule {
        running: false,
        pending: None,
    });

#[cfg(not(test))]
fn maintenance_schedule() -> std::sync::MutexGuard<'static, MaintenanceSchedule> {
    MAINTENANCE_SCHEDULE
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// 请求一轮维护（工作区新建/切换后补跑）。
///
/// 固定一条消费者线程；运行期间的新请求只覆盖“待跑工作区”，结束后补跑最新那一个。
#[cfg(not(test))]
pub fn spawn_workspace_run(context: AttachmentContext) {
    let should_spawn = maintenance_schedule().request(context);
    if !should_spawn {
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("attachment-maintenance".to_string())
        .spawn(move || {
            loop {
                let next = maintenance_schedule().take();
                let Some(context) = next else {
                    break;
                };
                match load_policy(&context) {
                    Ok(policy) => {
                        if let Err(error) = run(&context, now_ms(), policy) {
                            logging::error("attachment", &format!("工作区维护失败: {error}"));
                        }
                    }
                    Err(error) => {
                        logging::error("attachment", &format!("读取维护策略失败: {error}"));
                    }
                }
            }
        });
    if let Err(error) = spawned {
        logging::error("attachment", &format!("启动维护线程失败: {error}"));
        maintenance_schedule().running = false;
    }
}

/// 应用级看门狗：启动立即跑一轮，此后每 6 小时一次。
pub fn spawn_watchdog(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("attachment-watchdog".to_string())
        .spawn(move || {
            loop {
                let state = app.state::<AppState>();
                match AttachmentContext::from_state(state.inner()) {
                    Ok(context) => match load_policy(&context) {
                        Ok(policy) => {
                            if let Err(error) = run(&context, now_ms(), policy) {
                                logging::error("attachment", &format!("看门狗维护失败: {error}"));
                            }
                        }
                        Err(error) => {
                            logging::error(
                                "attachment",
                                &format!("看门狗读取维护策略失败: {error}"),
                            );
                        }
                    },
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

/// 扫描 objects 下无 DB 行的文件并移入 quarantine；返回（本轮移动数，过期隔离目录清理数）。
fn scan_orphan_files(
    connection: &Connection,
    context: &AttachmentContext,
    now: i64,
) -> AppResult<(i64, i64)> {
    let known_big: BTreeSet<String> = repository::list_blobs(connection)?
        .into_iter()
        .filter(|blob| blob.storage_kind == KIND_BIG)
        .map(|blob| blob.hash)
        .collect();
    let known_packs: BTreeSet<String> = repository::list_packs(connection)?
        .into_iter()
        .map(|pack| pack.id)
        .collect();

    let storage_root = &context.storage_root;
    let quarantine_root = storage_root.join(QUARANTINE_DIR);
    let run_directory = quarantine_dir_for(&quarantine_root, now);
    let cutoff = now.saturating_sub(ORPHAN_FILE_MIN_AGE_MS);
    let mut moved = 0_i64;

    // big：objects/big/<hh>/<hh>/<64hex>
    let big_root = storage_root.join("objects").join("big");
    if big_root.is_dir() {
        for first in fs::read_dir(&big_root)?.flatten() {
            if !first.file_type().is_ok_and(|kind| kind.is_dir()) {
                continue;
            }
            for second in fs::read_dir(first.path())?.flatten() {
                if !second.file_type().is_ok_and(|kind| kind.is_dir()) {
                    continue;
                }
                for file in fs::read_dir(second.path())?.flatten() {
                    let path = file.path();
                    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                        continue;
                    };
                    if !is_big_object_name(name) || known_big.contains(name) {
                        continue;
                    }
                    let relative = path
                        .strip_prefix(storage_root)
                        .unwrap_or(&path)
                        .to_path_buf();
                    if move_to_quarantine(&path, &relative, &run_directory, cutoff)? {
                        moved += 1;
                    }
                }
            }
        }
    }

    // packs：objects/small/packs/<id>.pack
    let packs_root = storage_root.join("objects").join("small").join("packs");
    if packs_root.is_dir() {
        for file in fs::read_dir(&packs_root)?.flatten() {
            let path = file.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            let Some(pack_id) = name.strip_suffix(".pack") else {
                continue;
            };
            if known_packs.contains(pack_id) {
                continue;
            }
            let relative = path
                .strip_prefix(storage_root)
                .unwrap_or(&path)
                .to_path_buf();
            if move_to_quarantine(&path, &relative, &run_directory, cutoff)? {
                moved += 1;
            }
        }
    }

    let removed_dirs = prune_quarantine(
        &quarantine_root,
        now.saturating_sub(QUARANTINE_RETENTION_MS),
    );
    Ok((moved, removed_dirs))
}

/// 本轮 quarantine 目录：时间戳 + 冲突序号。
fn quarantine_dir_for(root: &Path, now: i64) -> std::path::PathBuf {
    let base = root.join(now.to_string());
    if !base.exists() {
        return base;
    }
    for index in 1..1000 {
        let candidate = root.join(format!("{now}-{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    root.join(format!("{now}-overflow"))
}

/// 只移动“超过 24h 的普通文件”；失败只记录并保留原文件。
fn move_to_quarantine(
    path: &Path,
    relative: &Path,
    run_directory: &Path,
    cutoff: i64,
) -> AppResult<bool> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(false);
    };
    if !metadata.is_file() {
        return Ok(false);
    }
    let Some(modified) = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
    else {
        return Ok(false);
    };
    if modified > cutoff {
        return Ok(false);
    }
    let target = run_directory.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(path, &target) {
        Ok(()) => {
            logging::info(
                "attachment",
                &format!("孤儿文件已隔离 file={}", relative.to_string_lossy()),
            );
            Ok(true)
        }
        Err(error) => {
            logging::error(
                "attachment",
                &format!(
                    "隔离孤儿文件失败 file={}: {error}",
                    relative.to_string_lossy()
                ),
            );
            Ok(false)
        }
    }
}

/// 删除超过保留期的 quarantine 时间戳目录。
fn prune_quarantine(root: &Path, cutoff: i64) -> i64 {
    if !root.is_dir() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut removed = 0_i64;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(timestamp) = name
            .split('-')
            .next()
            .and_then(|value| value.parse::<i64>().ok())
        else {
            continue;
        };
        if timestamp > cutoff {
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => removed += 1,
            Err(error) => logging::error(
                "attachment",
                &format!("清理隔离目录失败 dir={name}: {error}"),
            ),
        }
    }
    removed
}

/// 64 位小写十六进制对象名；大写/短名/隐藏文件一律不动。
fn is_big_object_name(name: &str) -> bool {
    name.len() == 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
