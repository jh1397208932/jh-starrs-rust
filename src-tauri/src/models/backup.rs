//! 工作区备份 / 恢复 IPC 契约。

use serde::{Deserialize, Serialize};

use crate::models::WorkspaceDto;

/// 备份入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWorkspaceInput {
    /// 用户选择的目标父目录（绝对路径）。
    pub dest_dir: String,
}

/// 备份结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupWorkspaceResult {
    /// 实际创建的备份目录。
    pub path: String,
    pub files: i64,
    pub bytes: i64,
}

/// 恢复入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreWorkspaceInput {
    /// 备份目录；必须包含 manifest.json 与 db/workspace.sqlite3。
    pub backup_dir: String,
    /// 恢复目标目录；必须为空或不存在。
    pub target_dir: String,
}

/// 恢复结果；打开后返回当前工作区。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreWorkspaceResult {
    pub workspace: WorkspaceDto,
}
