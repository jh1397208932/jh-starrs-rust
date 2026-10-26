//! 工作区备份 / 恢复 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::backup::{
    BackupWorkspaceInput, BackupWorkspaceResult, RestoreWorkspaceInput, RestoreWorkspaceResult,
};
use crate::services::backup_service;
use crate::state::AppState;

/// 备份当前工作区。
#[tauri::command(async)]
pub fn backup_workspace(
    state: State<'_, AppState>,
    input: BackupWorkspaceInput,
) -> AppResult<BackupWorkspaceResult> {
    backup_service::backup(state.inner(), input)
}

/// 从备份恢复到空目录并打开。
#[tauri::command(async)]
pub fn restore_workspace(
    state: State<'_, AppState>,
    input: RestoreWorkspaceInput,
) -> AppResult<RestoreWorkspaceResult> {
    backup_service::restore(state.inner(), input)
}
