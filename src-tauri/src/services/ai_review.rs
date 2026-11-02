//! MCP 写入的人工确认：把「打算改什么」渲染成前后行级对比，推给主界面弹窗。
//!
//! 只读取当前状态，不写库；渲染失败绝不能让 MCP 调用失败，
//! 因为待审项本身已经落进待审区，设置页仍可处理。

use std::sync::OnceLock;

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::repositories::ai_repository;
use crate::services::{board_service, document_service, node_service};
use crate::state::AppState;

/// 待审对比事件名；前端监听后弹出确认窗。
pub const REVIEW_EVENT: &str = "starris://ai-review";
/// 单侧最多渲染的行数，超出折叠为一行提示。
const MAX_LINES: usize = 200;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// 由 `lib.rs` 的 setup 注入，使非命令线程（MCP 服务）也能向主窗口发事件。
pub fn bind(app: AppHandle) {
    let _ = APP.set(app);
}

/// 一条待审写入的前后对比。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReviewPreview {
    pub inbox_id: String,
    pub tool: String,
    pub risk: String,
    pub summary: String,
    /// 受影响内容的可读定位（节点标题与路径）
    pub target: String,
    /// 将被移除/覆盖的行
    pub removed: Vec<String>,
    /// 将新增/替换成的行
    pub added: Vec<String>,
}

/// 向主窗口推送待审对比；AppHandle 未绑定或发送失败只记日志。
pub fn emit(preview: &AiReviewPreview) {
    let Some(app) = APP.get() else {
        logging::error("ai", "待审对比未推送：AppHandle 尚未绑定");
        return;
    };
    if let Err(error) = app.emit(REVIEW_EVENT, preview) {
        logging::error("ai", &format!("待审对比推送失败: {error}"));
    }
}

/// 按工具渲染一条写入的前后对比。
pub fn preview(
    state: &AppState,
    inbox_id: &str,
    tool: &str,
    args: &Value,
    risk: &str,
) -> AppResult<AiReviewPreview> {
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let node_id = args.get("nodeId").and_then(Value::as_str);
    let target = match node_id {
        Some(id) => node_service::get(state, id)
            .map(|node| format!("{}（{}）", node.title, node.path))
            .unwrap_or_else(|_| id.to_string()),
        None => args
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| "新知识库内容".to_string()),
    };
    let (removed, added) = match tool {
        "doc_create" => {
            let markdown = args.get("markdown").and_then(Value::as_str).unwrap_or("");
            // 新建也要把写进去的正文逐行摊开：只报「共 N 段」等于让人确认一个看不见内容的改动。
            let body = fold_lines(
                markdown
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_string)
                    .collect(),
            );
            let mut added = vec![format!(
                "新建文档「{target}」，共 {} 段",
                markdown_line_count(markdown)
            )];
            added.extend(body);
            (vec![], added)
        }
        "doc_append_blocks" => (vec![], block_specs(args)),
        "doc_insert_after_block" => {
            let anchor = args.get("blockId").and_then(Value::as_str).unwrap_or("");
            let mut added = vec![format!("在段落 {anchor} 之后插入：")];
            added.extend(block_specs(args));
            (vec![], added)
        }
        "doc_update_block" => {
            let block_id = args
                .get("blockId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::validation("缺少 blockId"))?;
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            let rows = doc_rows(state, node_id)?;
            let removed = rows
                .iter()
                .filter(|(_, row)| row_id(row) == block_id)
                .map(|(line, _)| line.clone())
                .collect();
            (removed, vec![format!("段落 {block_id} → {text}")])
        }
        "doc_replace_range" => {
            let start = args.get("start").and_then(Value::as_u64).unwrap_or(0) as usize;
            let end = args.get("end").and_then(Value::as_u64).unwrap_or(0) as usize;
            let loaded = document_service::load(
                state,
                node_id.ok_or_else(|| AppError::validation("缺少 nodeId"))?,
            )?;
            let content = loaded
                .document
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let safe_end = end.min(content.len());
            let removed = content[start.min(content.len())..safe_end]
                .iter()
                .flat_map(|block| render_doc(&json!({ "content": [block] })))
                .collect();
            (removed, block_specs(args))
        }
        "doc_delete_block" => {
            let block_id = args
                .get("blockId")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::validation("缺少 blockId"))?;
            let rows = doc_rows(state, node_id)?;
            let removed = rows
                .iter()
                .filter(|(_, row)| row_id(row) == block_id)
                .map(|(line, _)| line.clone())
                .collect();
            (removed, vec![])
        }
        "board_add_elements" => (vec![], element_specs(args)),
        "board_update_element" => {
            let element_id = args.get("elementId").and_then(Value::as_str).unwrap_or("");
            let removed = board_rows(state, node_id)?
                .into_iter()
                .filter(|(_, element)| element_id_of(element) == element_id)
                .map(|(line, _)| line)
                .collect();
            let patch = args.get("patch").and_then(Value::as_object);
            let changes: Vec<String> = patch
                .map(|map| {
                    map.iter()
                        .map(|(key, value)| format!("{key}={}", render_value(value)))
                        .collect()
                })
                .unwrap_or_default();
            (
                removed,
                vec![format!("#{element_id} → {}", changes.join(", "))],
            )
        }
        "board_delete_elements" => {
            let ids: Vec<String> = args
                .get("elementIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let removed = board_rows(state, node_id)?
                .into_iter()
                .filter(|(_, element)| ids.iter().any(|id| id == element_id_of(element)))
                .map(|(line, _)| line)
                .collect();
            (removed, vec![])
        }
        "node_create_folder" => (
            vec![],
            vec![format!(
                "新建文件夹「{}」",
                args.get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("未命名")
            )],
        ),
        "node_rename" => {
            let old = node_service::get(
                state,
                node_id.ok_or_else(|| AppError::validation("缺少 nodeId"))?,
            )?;
            (
                vec![format!("标题：{}", old.title)],
                vec![format!(
                    "标题：{}",
                    args.get("title").and_then(Value::as_str).unwrap_or("")
                )],
            )
        }
        "node_move" => {
            let old = node_service::get(
                state,
                node_id.ok_or_else(|| AppError::validation("缺少 nodeId"))?,
            )?;
            let parent_id = args.get("parentId").and_then(Value::as_str);
            let destination = match parent_id {
                Some(id) => node_service::get(state, id)
                    .map(|parent| parent.path)
                    .unwrap_or_else(|_| id.to_string()),
                None => "/".to_string(),
            };
            (
                vec![format!("位置：{}", old.path)],
                vec![format!("位置：{destination}/{}", old.title)],
            )
        }
        "node_trash" => (
            vec![format!("节点：{target}")],
            vec!["进入回收站（可恢复）".to_string()],
        ),
        _ => (vec![], vec![format!("未渲染的写入：{tool}")]),
    };
    Ok(AiReviewPreview {
        inbox_id: inbox_id.to_string(),
        tool: tool.to_string(),
        risk: risk.to_string(),
        summary,
        target,
        removed: fold_lines(removed),
        added: fold_lines(added),
    })
}

/// 从待审区记录重建对比，供设置页重新打开确认窗。
pub fn preview_inbox(state: &AppState, inbox_id: &str) -> AppResult<AiReviewPreview> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let row = ai_repository::find_inbox(&session.connection, inbox_id)?
        .ok_or_else(|| AppError::not_found("待审项不存在"))?;
    let args: Value = serde_json::from_str(&row.payload_json)
        .map_err(|_| AppError::validation("待审项内容损坏"))?;
    drop(guard);
    preview(state, &row.id, &row.tool, &args, &row.risk)
}

fn doc_rows(state: &AppState, node_id: Option<&str>) -> AppResult<Vec<(String, Value)>> {
    let id = node_id.ok_or_else(|| AppError::validation("缺少 nodeId"))?;
    let loaded = document_service::load(state, id)?;
    Ok(render_doc(&loaded.document)
        .into_iter()
        .zip(loaded_rows(&loaded.document))
        .collect())
}

/// 展平后的行；与 `render_doc` 同一顺序，用于按 blockId 反查。
fn loaded_rows(document: &Value) -> Vec<Value> {
    crate::services::ai_service::flatten_blocks(document)
}

fn render_doc(document: &Value) -> Vec<String> {
    crate::services::ai_service::flatten_blocks(document)
        .iter()
        .map(|row| {
            let depth = row.get("depth").and_then(Value::as_u64).unwrap_or(0) as usize;
            let kind = row
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("paragraph");
            let text = row.get("text").and_then(Value::as_str).unwrap_or("");
            format!("{}{kind} {text}", "  ".repeat(depth))
        })
        .collect()
}

fn row_id(row: &Value) -> &str {
    row.get("blockId").and_then(Value::as_str).unwrap_or("")
}

fn block_specs(args: &Value) -> Vec<String> {
    args.get("blocks")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|block| {
                    format!(
                        "{} {}",
                        block
                            .get("type")
                            .and_then(Value::as_str)
                            .unwrap_or("paragraph"),
                        block.get("text").and_then(Value::as_str).unwrap_or("")
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn element_specs(args: &Value) -> Vec<String> {
    args.get("elements")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(render_element).collect())
        .unwrap_or_default()
}

fn board_rows(state: &AppState, node_id: Option<&str>) -> AppResult<Vec<(String, Value)>> {
    let id = node_id.ok_or_else(|| AppError::validation("缺少 nodeId"))?;
    let loaded = board_service::load(state, id)?;
    let elements = loaded.elements.as_array().cloned().unwrap_or_default();
    Ok(elements
        .iter()
        .map(|element| (render_element(element), element.clone()))
        .collect())
}

fn render_element(element: &Value) -> String {
    let kind = element
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("element");
    let label = element
        .get("label")
        .or_else(|| element.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let id = element.get("id").and_then(Value::as_str).unwrap_or("");
    format!("#{id} {kind} {label}")
}

fn element_id_of(element: &Value) -> &str {
    element.get("id").and_then(Value::as_str).unwrap_or("")
}

fn render_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn markdown_line_count(markdown: &str) -> usize {
    markdown
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count()
}

/// 行数超上限时折叠尾部，保证弹窗与事件负载有界。
fn fold_lines(mut lines: Vec<String>) -> Vec<String> {
    if lines.len() <= MAX_LINES {
        return lines;
    }
    let total = lines.len();
    lines.truncate(MAX_LINES);
    lines.push(format!("…（共 {total} 行，其余已省略）"));
    lines
}
