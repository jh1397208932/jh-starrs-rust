//! Starris Native 思维导图 JSON 导入导出。

use std::path::Path;

use serde_json::json;

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::MindmapContent;
use crate::services::mindmap_format::{ImportedMindmap, content_from_value, content_value};

/// 读取 `.starris-mindmap.json`。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let bytes = std::fs::read(path)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::validation("思维导图 JSON 文件过大"));
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::validation("思维导图 JSON 无法解析"))?;
    let content = content_from_value(value)?;
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("思维导图")
        .trim_end_matches(".starris-mindmap")
        .to_string();
    Ok(vec![ImportedMindmap {
        title,
        content,
        warnings: Vec::new(),
        image_resources: Vec::new(),
    }])
}

/// 写稳定 JSON。
pub fn export(content: &MindmapContent) -> AppResult<Vec<u8>> {
    let value = json!({
        "format": "starris-mindmap",
        "formatVersion": 1,
        "mindmap": content_value(content),
    });
    serde_json::to_vec_pretty(&value).map_err(|_| AppError::Internal)
}
