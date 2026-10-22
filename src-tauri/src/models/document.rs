//! 文档块存储 IPC 契约。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 保存文档入参；`document` 为 Tiptap `editor.getJSON()` 结果。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentInput {
    pub node_id: String,
    pub document: Value,
}

/// 新增块：仅包含工作区 hash 表中原本不存在的块。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockAddDto {
    pub hash: String,
    pub json: Value,
}

/// 分段顺序变更；`after`/`before` 为空表示头部/尾部。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderChangeDto {
    pub after: String,
    pub before: String,
    pub hash_list: Vec<String>,
}

/// 保存后的块实例（按最终顺序）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockNodeDto {
    pub id: String,
    pub hash: String,
    pub order: String,
}

/// 文档保存结果差量。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocSaveResult {
    pub add: Vec<BlockAddDto>,
    pub rm: Vec<String>,
    pub order: Vec<OrderChangeDto>,
    pub tree: Vec<BlockNodeDto>,
    pub word_count: i64,
    pub updated_at: i64,
}

/// 文档加载结果；正文缓存与块树一并返回。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocLoadResult {
    pub document: Value,
    pub word_count: i64,
    pub updated_at: i64,
    pub tree: Vec<BlockNodeDto>,
    /// 加载时是否修复了历史脏数据（前端需要自动补一次保存）。
    pub normalized: bool,
}
