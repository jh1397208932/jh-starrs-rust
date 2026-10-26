//! 云同步（文件夹版）：把工作区快照写入用户选择的云盘同步目录，
//! 在另一台设备上从同一目录恢复。全部动作手动触发，不后台改写用户文件。

use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::backup::{BackupWorkspaceInput, RestoreWorkspaceInput, RestoreWorkspaceResult};
use crate::models::cloud::{
    CloudRestoreInput, CloudSnapshotDto, CloudSyncFolderInput, CloudSyncStatusDto,
};
use crate::repositories::settings_repository;
use crate::services::backup_service;
use crate::state::AppState;
use crate::utils::now_ms;

const SETTING_SYNC_FOLDER: &str = "cloud.sync_folder";
const BACKUP_MANIFEST: &str = "backup.json";
const BACKUP_PREFIX: &str = "starris-backup-";

fn read_folder(state: &AppState) -> AppResult<Option<PathBuf>> {
    let global = state.global()?;
    Ok(settings_repository::get(&global, SETTING_SYNC_FOLDER)?
        .map(PathBuf::from)
        .filter(|path| path.is_dir()))
}

fn latest_snapshot(folder: &Path) -> Option<CloudSnapshotDto> {
    let mut latest: Option<CloudSnapshotDto> = None;
    let entries = fs::read_dir(folder).ok()?;
    for entry in entries.flatten() {
        if !entry.file_type().ok().is_some_and(|kind| kind.is_dir()) {
            continue;
        }
        let name = entry.file_name();
        if !name.to_string_lossy().starts_with(BACKUP_PREFIX) {
            continue;
        }
        let path = entry.path();
        if !path.join("db/workspace.sqlite3").is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(path.join(BACKUP_MANIFEST)) else {
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(created_at) = manifest["createdAt"].as_i64() else {
            continue;
        };
        let workspace_name = manifest["workspace"]["name"].as_str().unwrap_or("工作区");
        let candidate = CloudSnapshotDto {
            path: path.to_string_lossy().into_owned(),
            created_at,
            workspace_name: workspace_name.to_string(),
        };
        if latest
            .as_ref()
            .is_none_or(|current| candidate.created_at > current.created_at)
        {
            latest = Some(candidate);
        }
    }
    latest
}

fn status_for(folder: Option<PathBuf>) -> CloudSyncStatusDto {
    let latest = folder.as_deref().and_then(latest_snapshot);
    CloudSyncStatusDto {
        folder: folder.map(|path| path.to_string_lossy().into_owned()),
        latest,
    }
}

/// 当前同步状态。
pub fn status(state: &AppState) -> AppResult<CloudSyncStatusDto> {
    Ok(status_for(read_folder(state)?))
}

/// 设置同步文件夹；拒绝写入当前工作区内部，避免备份递归。
pub fn set_folder(state: &AppState, input: CloudSyncFolderInput) -> AppResult<CloudSyncStatusDto> {
    let folder = PathBuf::from(&input.folder);
    if !folder.is_absolute() {
        return Err(AppError::validation("同步文件夹必须是绝对路径"));
    }
    fs::create_dir_all(&folder)?;
    let probe = folder.join(".starris-write-test");
    fs::write(&probe, b"ok")?;
    let _ = fs::remove_file(&probe);

    let folder = folder.canonicalize()?;
    let workspace_root = {
        let guard = state.workspace()?;
        guard.as_ref().map(|session| session.root_path.clone())
    };
    if let Some(root) = workspace_root {
        let root = root.canonicalize().unwrap_or(root);
        if folder.starts_with(&root) {
            return Err(AppError::validation("同步文件夹不能放在工作区内部"));
        }
    }

    {
        let global = state.global()?;
        settings_repository::set(
            &global,
            SETTING_SYNC_FOLDER,
            &folder.to_string_lossy(),
            now_ms(),
        )?;
    }
    logging::info(
        "cloud",
        &format!("同步文件夹已设置 path={}", folder.display()),
    );
    Ok(status_for(Some(folder)))
}

/// 立即备份当前工作区到同步文件夹。
pub fn sync_now(state: &AppState) -> AppResult<CloudSyncStatusDto> {
    let folder = read_folder(state)?.ok_or_else(|| AppError::validation("请先选择同步文件夹"))?;
    let result = backup_service::backup(
        state,
        BackupWorkspaceInput {
            dest_dir: folder.to_string_lossy().into_owned(),
        },
    )?;
    logging::info(
        "cloud",
        &format!("同步完成 snapshot={} files={}", result.path, result.files),
    );
    Ok(status_for(Some(folder)))
}

/// 从同步文件夹的最新快照恢复到空目录并打开。
pub fn restore_latest(
    state: &AppState,
    input: CloudRestoreInput,
) -> AppResult<RestoreWorkspaceResult> {
    let folder = read_folder(state)?.ok_or_else(|| AppError::validation("请先选择同步文件夹"))?;
    let snapshot =
        latest_snapshot(&folder).ok_or_else(|| AppError::not_found("同步文件夹里还没有备份"))?;
    backup_service::restore(
        state,
        RestoreWorkspaceInput {
            backup_dir: snapshot.path,
            target_dir: input.target_dir,
        },
    )
}
