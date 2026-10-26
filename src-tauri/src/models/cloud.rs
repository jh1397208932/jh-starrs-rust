//! 云同步（文件夹版）IPC 契约：通过 iCloud/Dropbox 等同步目录交换工作区快照。

use serde::{Deserialize, Serialize};

/// 同步文件夹中的一份快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSnapshotDto {
    pub path: String,
    pub created_at: i64,
    pub workspace_name: String,
}

/// 当前同步状态：文件夹与最新快照。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncStatusDto {
    pub folder: Option<String>,
    pub latest: Option<CloudSnapshotDto>,
}

/// 设置同步文件夹。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncFolderInput {
    pub folder: String,
}

/// 从同步文件夹恢复最新快照到空目录。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRestoreInput {
    pub target_dir: String,
}
