//! 模板库 IPC 契约。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::NodeDto;

/// 模板类型。
pub const TEMPLATE_KIND_DOC: &str = "doc";
pub const TEMPLATE_KIND_BOARD: &str = "board";

/// 模板摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub id: String,
    pub name: String,
    /// `doc` 或 `board`
    pub kind: String,
    pub created_at: i64,
}

/// 保存当前文档/画板为模板。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplateInput {
    pub node_id: String,
    pub name: String,
}

/// 从模板创建节点。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFromTemplateInput {
    pub template_id: String,
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    pub title: String,
}

/// 模板文件内部结构；不直接暴露给前端。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFile {
    pub version: i64,
    pub id: String,
    pub name: String,
    pub kind: String,
    pub created_at: i64,
    pub content: Value,
}

/// 创建结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFromTemplateResult {
    pub node: NodeDto,
}
