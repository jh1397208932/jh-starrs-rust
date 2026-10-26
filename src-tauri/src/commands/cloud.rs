//! 云同步（同步文件夹）IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::backup::RestoreWorkspaceResult;
use crate::models::cloud::{CloudRestoreInput, CloudSyncFolderInput, CloudSyncStatusDto};
use crate::services::cloud_service;
use crate::state::AppState;

/// 读取同步文件夹与最新快照。
#[tauri::command(async)]
pub fn cloud_sync_status(state: State<'_, AppState>) -> AppResult<CloudSyncStatusDto> {
    cloud_service::status(state.inner())
}

/// 设置同步文件夹。
#[tauri::command(async)]
pub fn cloud_set_sync_folder(
    state: State<'_, AppState>,
    input: CloudSyncFolderInput,
) -> AppResult<CloudSyncStatusDto> {
    cloud_service::set_folder(state.inner(), input)
}

/// 立即同步当前工作区。
#[tauri::command(async)]
pub fn cloud_sync_now(state: State<'_, AppState>) -> AppResult<CloudSyncStatusDto> {
    cloud_service::sync_now(state.inner())
}

/// 从同步文件夹恢复最新快照。
#[tauri::command(async)]
pub fn cloud_restore_latest(
    state: State<'_, AppState>,
    input: CloudRestoreInput,
) -> AppResult<RestoreWorkspaceResult> {
    cloud_service::restore_latest(state.inner(), input)
}
