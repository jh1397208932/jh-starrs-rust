//! 工作区备份与恢复：数据库 + storage/objects 的完整副本。
//!
//! 备份是显式低频动作：数据库快照阶段持有存储锁与工作区会话锁，快照落盘后立即释放
//! 会话锁，只保留存储锁完成整目录拷贝——保存不会被分钟级的附件复制阻塞。
//! 一致性由存储锁保证：附件对象的增删都要先拿它，拷贝期间 objects/ 不会变化。
//! 恢复只允许写入空目录，完成后通过工作区统一切换入口打开。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::db;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::backup::{
    BackupWorkspaceInput, BackupWorkspaceResult, RestoreWorkspaceInput, RestoreWorkspaceResult,
};
use crate::services::attachment_service::AttachmentContext;
use crate::services::workspace_service;
use crate::state::AppState;
use crate::utils::now_ms;

/// 备份目录里的清单文件名。
const BACKUP_MANIFEST: &str = "backup.json";
/// 备份格式版本。
const BACKUP_VERSION: i64 = 1;

/// 备份当前工作区到 `dest_dir/starris-backup-<timestamp>/`。
pub fn backup(state: &AppState, input: BackupWorkspaceInput) -> AppResult<BackupWorkspaceResult> {
    let dest = PathBuf::from(&input.dest_dir);
    if !dest.is_absolute() {
        return Err(AppError::validation("备份位置无效"));
    }
    fs::create_dir_all(&dest)?;

    // 名称查询会短暂锁工作区；必须在持有会话守卫之前完成，避免同一线程重复加锁。
    let workspace_name = workspace_name(state)?;
    let context = AttachmentContext::from_state(state)?;
    // 先拿存储锁，再拿工作区会话锁；与维护任务的锁顺序一致，避免死锁。
    let _storage_lock = context.lock()?;
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let workspace_root = session.root_path.clone();

    let backup_root = dest.join(format!("starris-backup-{}", now_ms()));
    let backup_db_dir = backup_root.join("db");
    let backup_storage_dir = backup_root.join("storage");
    fs::create_dir_all(&backup_db_dir)?;
    fs::create_dir_all(&backup_storage_dir)?;

    // WAL checkpoint 后复制主库；数据库快照在这一刻确定。
    let db_connection = context.connection()?;
    db_connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    let db_path = db::paths::workspace_db_path(&workspace_root);
    fs::copy(&db_path, backup_db_dir.join("workspace.sqlite3"))?;
    // 快照已落盘：立刻放掉工作区会话锁，否则整目录拷贝期间所有文档保存都在排队。
    // 存储锁仍在手上，附件对象不会在拷贝期间被增删，快照与对象的对应关系不会被破坏。
    drop(guard);

    let mut files = 1_i64;
    let mut bytes = fs::metadata(backup_db_dir.join("workspace.sqlite3"))?.len() as i64;
    let source_objects = db::paths::workspace_storage_path(&workspace_root).join("objects");
    if source_objects.is_dir() {
        let (copied, copied_bytes) =
            copy_directory(&source_objects, &backup_storage_dir.join("objects"))?;
        files += copied;
        bytes += copied_bytes;
    }
    let source_templates = db::paths::workspace_storage_path(&workspace_root).join("templates");
    if source_templates.is_dir() {
        let (copied, copied_bytes) =
            copy_directory(&source_templates, &backup_storage_dir.join("templates"))?;
        files += copied;
        bytes += copied_bytes;
    }

    fs::write(
        backup_root.join(BACKUP_MANIFEST),
        serde_json::to_vec_pretty(&json!({
            "version": BACKUP_VERSION,
            "createdAt": now_ms(),
            "workspace": {
                "name": workspace_name,
                "path": workspace_root.to_string_lossy(),
            }
        }))
        .map_err(|_| AppError::Internal)?,
    )?;
    files += 1;

    logging::info(
        "backup",
        &format!(
            "工作区备份完成 dir={} files={} bytes={}",
            backup_root
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown"),
            files,
            bytes
        ),
    );
    Ok(BackupWorkspaceResult {
        path: db::paths::path_to_string(&backup_root)?,
        files,
        bytes,
    })
}

/// 从备份目录恢复到新的空目录，并打开恢复后的工作区。
pub fn restore(
    state: &AppState,
    input: RestoreWorkspaceInput,
) -> AppResult<RestoreWorkspaceResult> {
    let backup_root = PathBuf::from(&input.backup_dir);
    let target = PathBuf::from(&input.target_dir);
    if !backup_root.is_absolute() || !target.is_absolute() {
        return Err(AppError::validation("备份或恢复位置无效"));
    }
    if !backup_root.join(BACKUP_MANIFEST).is_file() {
        return Err(AppError::validation("所选文件夹不是星屿备份"));
    }
    let backup_db = backup_root.join("db/workspace.sqlite3");
    if !backup_db.is_file() {
        return Err(AppError::validation("备份缺少工作区数据库"));
    }
    if target.exists() {
        if !target.is_dir() {
            return Err(AppError::validation("请选择空文件夹"));
        }
        let mut entries = fs::read_dir(&target)?;
        if entries.next().is_some() {
            return Err(AppError::conflict("恢复目标必须是空文件夹"));
        }
    } else {
        fs::create_dir_all(&target)?;
    }

    fs::create_dir_all(target.join("db"))?;
    fs::create_dir_all(target.join("storage"))?;
    fs::copy(&backup_db, target.join("db/workspace.sqlite3"))?;
    let backup_objects = backup_root.join("storage/objects");
    if backup_objects.is_dir() {
        copy_directory(&backup_objects, &target.join("storage/objects"))?;
    }
    let backup_templates = backup_root.join("storage/templates");
    if backup_templates.is_dir() {
        copy_directory(&backup_templates, &target.join("storage/templates"))?;
    }

    let workspace = workspace_service::open(state, &input.target_dir)?;
    logging::info(
        "backup",
        &format!("工作区恢复完成 id={} name={}", workspace.id, workspace.name),
    );
    Ok(RestoreWorkspaceResult { workspace })
}

fn workspace_name(state: &AppState) -> AppResult<String> {
    let current_id = state.current_workspace_id()?;
    let global = state.global()?;
    let record = current_id
        .and_then(|id| {
            crate::repositories::workspace_repository::find_by_id(&global, &id)
                .ok()
                .flatten()
        })
        .ok_or(AppError::NoActiveWorkspace)?;
    Ok(record.name)
}

/// 递归复制普通目录；跳过符号链接，返回（文件数、字节数）。
fn copy_directory(source: &Path, target: &Path) -> AppResult<(i64, i64)> {
    fs::create_dir_all(target)?;
    let mut files = 0_i64;
    let mut bytes = 0_i64;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let destination = target.join(entry.file_name());
        if metadata.is_dir() {
            let (child_files, child_bytes) = copy_directory(&entry.path(), &destination)?;
            files += child_files;
            bytes += child_bytes;
        } else if metadata.is_file() {
            fs::copy(entry.path(), &destination)?;
            files += 1;
            bytes += metadata.len() as i64;
        }
    }
    Ok((files, bytes))
}
