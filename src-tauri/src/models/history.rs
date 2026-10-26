//! 文档历史 IPC 契约。

use serde::{Deserialize, Serialize};

/// 历史快照摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocHistorySummary {
    pub id: String,
    pub word_count: i64,
    pub created_at: i64,
}

/// 恢复历史快照入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDocHistoryInput {
    pub node_id: String,
    pub history_id: String,
}
