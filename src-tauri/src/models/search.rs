//! 工作区检索 IPC 契约。

use serde::{Deserialize, Serialize};

/// 默认返回条数。
fn default_limit() -> i64 {
    20
}

/// 检索入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchNodesInput {
    /// 空字符串表示“最近更新”，用于快速跳转。
    pub query: String,
    pub knowledge_base_id: String,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

/// 单条检索结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub node_id: String,
    pub title: String,
    pub kb_id: String,
    pub kb_name: String,
    /// 节点类型：1 文件夹、2 文档、3 画板、4 表格、5 流程图、6 附件。
    pub node_type: i64,
    pub snippet: String,
    pub updated_at: i64,
}

/// 知识网络条目（反链 / 相关）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkItemDto {
    pub id: String,
    pub title: String,
    pub kb_name: String,
    pub node_type: i64,
}

/// 当前节点的反向链接与相关推荐。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeNetworkDto {
    pub backlinks: Vec<NetworkItemDto>,
    pub related: Vec<NetworkItemDto>,
}
