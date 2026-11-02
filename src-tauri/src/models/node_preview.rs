//! 文档内嵌预览：源节点（画板/思维导图）到预览图片对象的索引。

use serde::{Deserialize, Serialize};

/// `node_preview` 表行。
#[derive(Debug, Clone)]
pub struct NodePreviewRow {
    pub node_id: String,
    pub object_id: String,
    pub width: i64,
    pub height: i64,
    /// 生成时源节点的 `update_time`，用于判断是否过期。
    pub source_updated_at: i64,
    pub updated_at: i64,
}

/// 预览图 IPC 输出；`dataUrl` 可直接放进 `<img src>`。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePreviewDto {
    pub node_id: String,
    pub data_url: String,
    pub width: i64,
    pub height: i64,
    pub source_updated_at: i64,
    /// 源节点在预览生成后又更新过；前端据此后台重生成，旧图先顶着。
    pub stale: bool,
}

/// 前端渲染完成后写回预览。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNodePreviewInput {
    pub node_id: String,
    #[serde(rename = "dataBase64")]
    pub data_base64: String,
    pub width: i64,
    pub height: i64,
    /// 渲染时源节点的 `update_time`
    pub source_updated_at: i64,
}

/// 保存结果；不重复下发图片字节。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNodePreviewResult {
    pub node_id: String,
    pub object_id: String,
    pub width: i64,
    pub height: i64,
    pub source_updated_at: i64,
    pub updated_at: i64,
}
