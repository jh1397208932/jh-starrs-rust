//! 组件库 IPC 契约：库、库内组件、导入与启用状态。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 组件库来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LibrarySourceType {
    Preset,
    Import,
}

impl LibrarySourceType {
    /// 数据库字符串 → 枚举。
    pub fn from_db(value: &str) -> Option<Self> {
        match value {
            "preset" => Some(Self::Preset),
            "import" => Some(Self::Import),
            _ => None,
        }
    }

    /// 枚举 → 数据库字符串。
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Preset => "preset",
            Self::Import => "import",
        }
    }
}

/// 组件库摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDto {
    pub id: String,
    pub name: String,
    pub author: String,
    pub license: String,
    pub source_url: String,
    pub source_type: LibrarySourceType,
    pub enabled: bool,
    pub item_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 库内组件；elements 直接对应 Excalidraw LibraryItem.elements。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItemDto {
    pub id: String,
    pub name: String,
    pub status: String,
    pub elements: Value,
    pub created: i64,
    pub library_id: String,
    pub library_name: String,
    pub library_source_type: LibrarySourceType,
}

/// 导入库入参；路径来自文件选择器。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLibraryInput {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub source_url: Option<String>,
}

/// 启用/禁用入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLibraryEnabledInput {
    pub id: String,
    pub enabled: bool,
}

/// 删除导入库结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteLibraryResult {
    pub deleted_items: i64,
}
