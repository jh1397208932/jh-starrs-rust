//! 画板持久化 IPC 契约：场景、视口与保存结果。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 画板视口；与 Excalidraw `scrollX/scrollY/zoom.value` 对应。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardViewportDto {
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub zoom: f64,
}

/// 画板加载结果；`files` 只包含图片对象，键与 `object_id` 相同。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardLoadResult {
    pub node_id: String,
    pub elements: Value,
    pub app_state: Value,
    pub viewport: BoardViewportDto,
    pub files: Vec<BoardFileDto>,
    pub version: i64,
    pub updated_at: i64,
    /// 图元引用了但全局对象库中已不存在/非活跃的 object_id。
    pub missing_object_ids: Vec<String>,
}

/// 画板图片文件；`id` 即全局 object_id。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFileDto {
    pub id: String,
    pub mime_type: String,
    pub data_url: String,
    pub created: i64,
}

/// 画板保存入参；不包含文件字节，对象在粘贴/插入时已进入全局对象库。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSaveInput {
    pub node_id: String,
    pub base_version: i64,
    pub elements: Value,
    #[serde(default)]
    pub app_state: Value,
}

/// 画板保存结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSaveResult {
    pub version: i64,
    pub updated_at: i64,
    pub element_count: i64,
}

/// 画板视口保存入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardSaveViewportInput {
    pub node_id: String,
    #[serde(default)]
    pub scroll_x: f64,
    #[serde(default)]
    pub scroll_y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

/// Excalidraw 默认缩放为 1。
fn default_zoom() -> f64 {
    1.0
}
