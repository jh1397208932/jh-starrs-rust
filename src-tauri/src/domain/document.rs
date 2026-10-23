//! 文档 JSON 领域规则：规范化、顶层块提取、xxh3-128 内容哈希、字数与派生元数据。

use serde_json::{Map, Value, json};
use xxhash_rust::xxh3::xxh3_128;

use crate::errors::{AppError, AppResult};

/// 一个待持久化的顶层块。
#[derive(Debug, Clone)]
pub struct ExtractedBlock {
    /// 32 位小写 hex（xxh3-128）。
    pub hash: String,
    /// 规范化 JSON 字符串，作为 `doc_block_hash.json`。
    pub canonical: String,
    /// 规范化块值，随 `add` 差量返回。
    pub value: Value,
}

/// 规范化后的文档及其顶层块。
#[derive(Debug, Clone)]
pub struct PreparedDocument {
    /// 可直接写入 `node.content` 的根文档。
    pub document: Value,
    /// 顶层块（hash 基于规范化 JSON）。
    pub blocks: Vec<ExtractedBlock>,
    /// 是否修复了历史脏数据（前端据此自动补一次保存）。
    pub changed: bool,
}

/// 规范化并切分 Tiptap 文档。
///
/// 规则（前后端共同遵守的唯一权威实现）：
/// - 根必须是 `type=doc`，`content` 缺失/null 视为空数组；
/// - `emoji` 节点必须带非空 `name`，否则删除（历史 `:null:` 脏数据）；
/// - 删除值为 null 的 `attrs` 项、空 marks 与空 text；
/// - 保持其余节点/属性不变。
///
/// @example `prepare_document(&json!({"type":"doc","content":[]}))`
pub fn prepare_document(document: &Value) -> AppResult<PreparedDocument> {
    let root = document
        .as_object()
        .ok_or_else(|| AppError::validation("文档必须是 JSON 对象"))?;
    if root.get("type").and_then(Value::as_str) != Some("doc") {
        return Err(AppError::validation("文档根节点 type 必须是 doc"));
    }
    let mut changed = false;
    let mut normalized_root = Map::new();
    for (key, value) in root {
        match key.as_str() {
            "content" => {
                let blocks = match value {
                    Value::Null => {
                        changed = true;
                        Vec::new()
                    }
                    Value::Array(blocks) => {
                        let mut normalized = Vec::with_capacity(blocks.len());
                        for block in blocks {
                            if !block.is_object() {
                                return Err(AppError::validation("文档顶层块必须是 JSON 对象"));
                            }
                            if let Some(node) = normalize_node(block, &mut changed) {
                                normalized.push(node);
                            }
                        }
                        normalized
                    }
                    _ => return Err(AppError::validation("文档 content 必须是块数组")),
                };
                normalized_root.insert(key.clone(), Value::Array(blocks));
            }
            _ => {
                if value.is_null() {
                    changed = true;
                } else {
                    normalized_root.insert(key.clone(), value.clone());
                }
            }
        }
    }
    if !normalized_root.contains_key("content") {
        changed = true;
        normalized_root.insert("content".to_string(), Value::Array(Vec::new()));
    }
    let normalized = Value::Object(normalized_root);
    let blocks = extract_normalized_blocks(&normalized)?;
    Ok(PreparedDocument {
        document: normalized,
        blocks,
        changed,
    })
}

fn extract_normalized_blocks(document: &Value) -> AppResult<Vec<ExtractedBlock>> {
    let content = document
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::validation("文档 content 必须是块数组"))?;
    let mut extracted = Vec::with_capacity(content.len());
    for block in content {
        let canonical = serde_json::to_string(block).map_err(|error| {
            crate::logging::error("document", &format!("块序列化失败: {error}"));
            AppError::Internal
        })?;
        let hash = format!("{:032x}", xxh3_128(canonical.as_bytes()));
        extracted.push(ExtractedBlock {
            hash,
            canonical,
            value: block.clone(),
        });
    }
    Ok(extracted)
}

/// 递归规范化单个节点；返回 None 表示该节点应被删除。
fn normalize_node(value: &Value, changed: &mut bool) -> Option<Value> {
    let Some(object) = value.as_object() else {
        *changed = true;
        return None;
    };
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if node_type == "emoji" {
        let name = object
            .get("attrs")
            .and_then(|attrs| attrs.get("name"))
            .and_then(Value::as_str);
        if name.is_none_or(|name| name.trim().is_empty()) {
            *changed = true;
            return None;
        }
    }

    let mut normalized = Map::new();
    for (key, child) in object {
        match key.as_str() {
            "attrs" => match child {
                Value::Null => *changed = true,
                Value::Object(attrs) => {
                    let mut cleaned = Map::new();
                    for (attr_key, attr_value) in attrs {
                        if attr_value.is_null() {
                            *changed = true;
                        } else {
                            cleaned.insert(attr_key.clone(), attr_value.clone());
                        }
                    }
                    if !cleaned.is_empty() {
                        normalized.insert(key.clone(), Value::Object(cleaned));
                    }
                }
                _ => {
                    normalized.insert(key.clone(), child.clone());
                }
            },
            "marks" => match child {
                Value::Null => *changed = true,
                Value::Array(marks) => {
                    let mut cleaned = Vec::with_capacity(marks.len());
                    for mark in marks {
                        if let Some(mark) = normalize_node(mark, changed) {
                            cleaned.push(mark);
                        }
                    }
                    if cleaned.is_empty() {
                        *changed = true;
                    } else {
                        normalized.insert(key.clone(), Value::Array(cleaned));
                    }
                }
                _ => {
                    normalized.insert(key.clone(), child.clone());
                }
            },
            "content" => match child {
                Value::Null => *changed = true,
                Value::Array(children) => {
                    let mut cleaned = Vec::with_capacity(children.len());
                    for child in children {
                        if let Some(node) = normalize_node(child, changed) {
                            cleaned.push(node);
                        }
                    }
                    if cleaned.is_empty() && node_type != "doc" {
                        *changed = true;
                    } else {
                        normalized.insert(key.clone(), Value::Array(cleaned));
                    }
                }
                _ => {
                    normalized.insert(key.clone(), child.clone());
                }
            },
            "text" => match child {
                Value::Null => *changed = true,
                Value::String(text) if node_type == "text" && text.is_empty() => {
                    *changed = true;
                    return None;
                }
                _ => {
                    normalized.insert(key.clone(), child.clone());
                }
            },
            _ => {
                if child.is_null() {
                    *changed = true;
                } else {
                    normalized.insert(key.clone(), child.clone());
                }
            }
        }
    }
    Some(Value::Object(normalized))
}

/// 统计文档文本节点字数（忽略空白字符）。
///
/// 与编辑器展示的“字数”一致；图片、表格结构等非文本节点不计数。
pub fn count_text_chars(document: &Value) -> i64 {
    let mut total = 0i64;
    collect_text_chars(document, &mut total);
    total
}

fn collect_text_chars(value: &Value, total: &mut i64) {
    match value {
        Value::Object(object) => {
            let is_text_node = object.get("type").and_then(Value::as_str) == Some("text");
            if is_text_node && let Some(text) = object.get("text").and_then(Value::as_str) {
                *total += text
                    .chars()
                    .filter(|character| !character.is_whitespace())
                    .count() as i64;
            }
            if let Some(children) = object.get("content").and_then(Value::as_array) {
                for child in children {
                    collect_text_chars(child, total);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_text_chars(item, total);
            }
        }
        _ => {}
    }
}

/// 生成派生属性；`prop` 列必须始终是合法 JSON 对象。
pub fn document_props(document: &Value) -> Value {
    let mut stats = DocumentStats::default();
    collect_stats(document, &mut stats);
    json!({
        "version": 1,
        "wordCount": count_text_chars(document),
        "blockCount": stats.block_count,
        "headingCount": stats.heading_count,
        "listCount": stats.list_count,
        "tableCount": stats.table_count,
        "codeBlockCount": stats.code_block_count,
        "imageCount": stats.image_count,
        "attachmentCount": stats.attachment_count,
    })
}

#[derive(Default)]
struct DocumentStats {
    block_count: usize,
    heading_count: usize,
    list_count: usize,
    table_count: usize,
    code_block_count: usize,
    image_count: usize,
    attachment_count: usize,
}

fn collect_stats(value: &Value, stats: &mut DocumentStats) {
    match value {
        Value::Object(object) => {
            match object.get("type").and_then(Value::as_str) {
                Some("heading") => stats.heading_count += 1,
                Some("table") => stats.table_count += 1,
                Some("codeBlock") => stats.code_block_count += 1,
                Some("image") => stats.image_count += 1,
                Some("attachmentImage") => stats.image_count += 1,
                Some("attachmentBlock") => {
                    stats.attachment_count += object
                        .get("attrs")
                        .and_then(|attrs| attrs.get("items"))
                        .and_then(Value::as_array)
                        .map_or(0, Vec::len);
                }
                Some("bulletList" | "orderedList" | "taskList") => stats.list_count += 1,
                _ => {}
            }
            if let Some(children) = object.get("content").and_then(Value::as_array) {
                if object.get("type").and_then(Value::as_str) == Some("doc") {
                    stats.block_count = children.len();
                }
                for child in children {
                    collect_stats(child, stats);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_stats(item, stats);
            }
        }
        _ => {}
    }
}

/// 将规范化后的 Tiptap 文档转成 Markdown 派生文本。
///
/// 仅用于元数据/检索，不反向驱动编辑器；内联 base64 图片不复制进 Markdown。
pub fn to_markdown(document: &Value) -> String {
    let mut markdown = String::new();
    if let Some(blocks) = document.get("content").and_then(Value::as_array) {
        for block in blocks {
            render_block(block, 0, &mut markdown);
        }
    }
    let trimmed = markdown.trim_end();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    }
}

fn render_block(node: &Value, indent: usize, out: &mut String) {
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
    match node_type {
        "paragraph" => {
            let text = render_inline(node);
            if !text.is_empty() {
                out.push_str(&" ".repeat(indent));
                out.push_str(&text);
            }
            out.push('\n');
            out.push('\n');
        }
        "heading" => {
            let level = node
                .get("attrs")
                .and_then(|attrs| attrs.get("level"))
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6) as usize;
            out.push_str(&"#".repeat(level));
            out.push(' ');
            out.push_str(&render_inline(node));
            out.push_str("\n\n");
        }
        "bulletList" => render_list(node, indent, ListKind::Bullet, out),
        "orderedList" => render_list(node, indent, ListKind::Ordered, out),
        "taskList" => render_list(node, indent, ListKind::Task, out),
        "blockquote" => {
            let mut inner = String::new();
            for child in children(node) {
                render_block(child, 0, &mut inner);
            }
            for line in inner.trim_end().lines() {
                if line.is_empty() {
                    out.push_str(">\n");
                } else {
                    out.push_str("> ");
                    out.push_str(line);
                    out.push('\n');
                }
            }
            out.push('\n');
        }
        "codeBlock" => {
            let language = node
                .get("attrs")
                .and_then(|attrs| attrs.get("language"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let code = node.get("content").and_then(Value::as_array).map_or_else(
                || {
                    node.get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                },
                |items| {
                    items
                        .iter()
                        .filter_map(|item| item.get("text").and_then(Value::as_str))
                        .collect::<String>()
                },
            );
            let fence_len = max_backtick_run(&code).max(2) + 1;
            let fence = "`".repeat(fence_len);
            out.push_str(&fence);
            out.push_str(language);
            out.push('\n');
            out.push_str(&code);
            if !code.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(&fence);
            out.push_str("\n\n");
        }
        "horizontalRule" => out.push_str("---\n\n"),
        "image" => {
            out.push_str(&render_image(node));
            out.push_str("\n\n");
        }
        "attachmentImage" => {
            out.push_str(&render_attachment_image(node));
            out.push_str("\n\n");
        }
        "attachmentBlock" => render_attachment_block(node, out),
        "table" => render_table(node, out),
        "details" => {
            let summary = children(node)
                .iter()
                .find(|child| child.get("type").and_then(Value::as_str) == Some("detailsSummary"))
                .map(render_inline)
                .unwrap_or_default();
            out.push_str("<details>\n<summary>");
            out.push_str(&summary);
            out.push_str("</summary>\n\n");
            if let Some(content) = children(node)
                .iter()
                .find(|child| child.get("type").and_then(Value::as_str) == Some("detailsContent"))
            {
                for child in children(content) {
                    render_block(child, indent, out);
                }
            }
            out.push_str("</details>\n\n");
        }
        "hardBreak" => out.push_str("  \n"),
        "emoji" => {
            if let Some(name) = node
                .get("attrs")
                .and_then(|attrs| attrs.get("name"))
                .and_then(Value::as_str)
            {
                out.push(':');
                out.push_str(name);
                out.push(':');
            }
        }
        _ => {
            for child in children(node) {
                render_block(child, indent, out);
            }
        }
    }
}

#[derive(Clone, Copy)]
enum ListKind {
    Bullet,
    Ordered,
    Task,
}

fn render_list(node: &Value, indent: usize, kind: ListKind, out: &mut String) {
    let start = node
        .get("attrs")
        .and_then(|attrs| attrs.get("start"))
        .and_then(Value::as_u64)
        .unwrap_or(1);
    for (index, item) in children(node).iter().enumerate() {
        let marker = match kind {
            ListKind::Bullet => "- ".to_string(),
            ListKind::Ordered => format!("{}. ", start + index as u64),
            ListKind::Task => {
                let checked = item
                    .get("attrs")
                    .and_then(|attrs| attrs.get("checked"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if checked {
                    "- [x] ".to_string()
                } else {
                    "- [ ] ".to_string()
                }
            }
        };
        render_list_item(item, indent, &marker, out);
    }
    out.push('\n');
}

fn render_list_item(item: &Value, indent: usize, marker: &str, out: &mut String) {
    let mut first = true;
    for child in children(item) {
        let child_type = child
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match child_type {
            "paragraph" => {
                out.push_str(&" ".repeat(indent));
                if first {
                    out.push_str(marker);
                    first = false;
                } else {
                    out.push_str("  ");
                }
                out.push_str(&render_inline(child));
                out.push('\n');
            }
            "bulletList" => render_list(child, indent + 2, ListKind::Bullet, out),
            "orderedList" => render_list(child, indent + 2, ListKind::Ordered, out),
            "taskList" => render_list(child, indent + 2, ListKind::Task, out),
            _ => render_block(child, indent + 2, out),
        }
    }
    if first {
        out.push_str(&" ".repeat(indent));
        out.push_str(marker);
        out.push('\n');
    }
}

fn render_table(node: &Value, out: &mut String) {
    let rows: Vec<&Value> = children(node)
        .iter()
        .filter(|row| row.get("type").and_then(Value::as_str) == Some("tableRow"))
        .collect();
    if rows.is_empty() {
        return;
    }
    let mut widths: Vec<usize> = Vec::new();
    for row in &rows {
        for (index, cell) in children(row).iter().enumerate() {
            let width = render_inline(cell).chars().count().max(3);
            if index >= widths.len() {
                widths.push(width);
            } else {
                widths[index] = widths[index].max(width);
            }
        }
    }
    for (row_index, row) in rows.iter().enumerate() {
        out.push('|');
        for (cell_index, cell) in children(row).iter().enumerate() {
            let text = render_cell(cell, widths.get(cell_index).copied().unwrap_or(3));
            out.push(' ');
            out.push_str(&text);
            out.push_str(" |");
        }
        out.push('\n');
        if row_index == 0 {
            out.push('|');
            for width in &widths {
                out.push(' ');
                out.push_str(&"-".repeat(*width));
                out.push_str(" |");
            }
            out.push('\n');
        }
    }
    out.push('\n');
}

fn render_cell(node: &Value, min_width: usize) -> String {
    let mut text = render_inline(node).replace('|', "\\|").replace('\n', " ");
    let width = text.chars().count();
    if width < min_width {
        text.push_str(&" ".repeat(min_width - width));
    }
    text
}

fn render_inline(node: &Value) -> String {
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
    match node_type {
        "text" => {
            let text = node.get("text").and_then(Value::as_str).unwrap_or_default();
            apply_marks(text, node.get("marks").and_then(Value::as_array))
        }
        "hardBreak" => "  \n".to_string(),
        "emoji" => node
            .get("attrs")
            .and_then(|attrs| attrs.get("name"))
            .and_then(Value::as_str)
            .map(|name| format!(":{name}:"))
            .unwrap_or_default(),
        "image" => render_image(node),
        "attachmentImage" => render_attachment_image(node),
        _ => {
            let mut result = String::new();
            for child in children(node) {
                result.push_str(&render_inline(child));
            }
            result
        }
    }
}

fn render_image(node: &Value) -> String {
    let attrs = node.get("attrs");
    let alt = attrs
        .and_then(|attrs| attrs.get("alt"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let src = attrs
        .and_then(|attrs| attrs.get("src"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if src.is_empty() || src.starts_with("data:") {
        // 内联 base64 不进入派生 Markdown，避免元数据体积翻倍。
        return format!("![{}]()", escape_inline(alt));
    }
    format!("![{}]({})", escape_inline(alt), src)
}

fn render_attachment_image(node: &Value) -> String {
    let attrs = node.get("attrs");
    let id = attrs
        .and_then(|attrs| attrs.get("attachmentId"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let name = attrs
        .and_then(|attrs| attrs.get("alt"))
        .or_else(|| attrs.and_then(|attrs| attrs.get("name")))
        .and_then(Value::as_str)
        .unwrap_or("图片");
    format!("![{}](attachment://{})", escape_inline(name), id)
}

fn render_attachment_block(node: &Value, out: &mut String) {
    let items = node
        .get("attrs")
        .and_then(|attrs| attrs.get("items"))
        .and_then(Value::as_array);
    if let Some(items) = items {
        for item in items {
            let id = item
                .get("attachmentId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let name = item.get("name").and_then(Value::as_str).unwrap_or("附件");
            out.push_str("- [");
            out.push_str(&escape_inline(name));
            out.push_str("](attachment://");
            out.push_str(id);
            out.push_str(")\n");
        }
    }
    out.push('\n');
}

fn apply_marks(text: &str, marks: Option<&Vec<Value>>) -> String {
    let Some(marks) = marks else {
        return escape_inline(text);
    };
    let mut has_bold = false;
    let mut has_italic = false;
    let mut has_strike = false;
    let mut has_code = false;
    let mut has_underline = false;
    let mut has_subscript = false;
    let mut has_superscript = false;
    let mut link = None;
    for mark in marks {
        match mark.get("type").and_then(Value::as_str) {
            Some("bold") => has_bold = true,
            Some("italic") => has_italic = true,
            Some("strike") => has_strike = true,
            Some("code") => has_code = true,
            Some("underline") => has_underline = true,
            Some("subscript") => has_subscript = true,
            Some("superscript") => has_superscript = true,
            Some("link") => {
                link = mark
                    .get("attrs")
                    .and_then(|attrs| attrs.get("href"))
                    .and_then(Value::as_str)
            }
            _ => {}
        }
    }
    let mut rendered = if has_code {
        wrap_code(text)
    } else {
        escape_inline(text)
    };
    if has_bold {
        rendered = format!("**{rendered}**");
    }
    if has_italic {
        rendered = format!("*{rendered}*");
    }
    if has_strike {
        rendered = format!("~~{rendered}~~");
    }
    if has_subscript {
        rendered = format!("<sub>{rendered}</sub>");
    }
    if has_superscript {
        rendered = format!("<sup>{rendered}</sup>");
    }
    if has_underline {
        rendered = format!("<u>{rendered}</u>");
    }
    if let Some(href) = link.filter(|href| is_safe_link(href)) {
        rendered = format!("[{rendered}]({})", wrap_link_destination(href));
    }
    rendered
}

fn wrap_code(text: &str) -> String {
    let fence = "`".repeat(max_backtick_run(text) + 1);
    if text.starts_with(' ') || text.ends_with(' ') {
        format!("{fence} {text} {fence}")
    } else {
        format!("{fence}{text}{fence}")
    }
}

/// 最长连续反引号长度；围栏必须比内容里的最长反引号更长。
fn max_backtick_run(text: &str) -> usize {
    let mut longest = 0;
    let mut current = 0;
    for character in text.chars() {
        if character == '`' {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    longest
}

fn is_safe_link(href: &str) -> bool {
    let lower = href.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with('#')
        || lower.starts_with('/')
        || (!lower.contains(':') && !lower.is_empty())
}

fn wrap_link_destination(href: &str) -> String {
    let sanitized = href.trim().replace(['\n', '\r', ')'], "%29");
    if sanitized.contains(' ') {
        format!("<{sanitized}>")
    } else {
        sanitized
    }
}

fn escape_inline(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        if matches!(
            character,
            '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '~'
        ) {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hashes_are_stable_and_content_addressed() {
        let first = json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"hello"}]}
        ]});
        let same = json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"hello"}]}
        ]});
        let different = json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"hello!"}]}
        ]});

        let first_blocks = prepare_document(&first).expect("解析").blocks;
        let same_blocks = prepare_document(&same).expect("解析").blocks;
        let different_blocks = prepare_document(&different).expect("解析").blocks;
        assert_eq!(first_blocks[0].hash, same_blocks[0].hash);
        assert_ne!(first_blocks[0].hash, different_blocks[0].hash);
        assert_eq!(first_blocks[0].hash.len(), 32);
        assert!(
            first_blocks[0]
                .hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        );
    }

    #[test]
    fn rejects_non_doc_roots() {
        assert!(prepare_document(&json!({"type":"paragraph"})).is_err());
        assert!(prepare_document(&json!([{"type":"paragraph"}])).is_err());
        assert!(prepare_document(&json!({"type":"doc","content":{}})).is_err());
        assert!(prepare_document(&json!({"type":"doc","content":["not-a-block"]})).is_err());
    }

    #[test]
    fn empty_document_has_no_blocks() {
        assert!(
            prepare_document(&json!({"type":"doc","content":[]}))
                .unwrap()
                .blocks
                .is_empty()
        );
        assert!(
            prepare_document(&json!({"type":"doc"}))
                .unwrap()
                .blocks
                .is_empty()
        );
        assert_eq!(count_text_chars(&json!({"type":"doc"})), 0);
    }

    #[test]
    fn word_count_ignores_whitespace_and_non_text_nodes() {
        let document = json!({"type":"doc","content":[
            {"type":"paragraph","content":[
                {"type":"text","text":"你 好"},
                {"type":"text","text":" world "}
            ]},
            {"type":"image","attrs":{"src":"data:image/png;base64,AAAA"}}
        ]});
        assert_eq!(count_text_chars(&document), 7, "你好world = 7 个非空白字符");
    }

    #[test]
    fn normalization_removes_invalid_emoji_and_null_attrs() {
        let document = json!({"type":"doc","content":[
            {"type":"paragraph","attrs":{"textAlign":null},"content":[
                {"type":"text","text":"a"},
                {"type":"emoji","attrs":{"name":null}},
                {"type":"emoji","attrs":{"name":"smile"}},
                {"type":"text","text":""}
            ]}
        ]});
        let prepared = prepare_document(&document).expect("规范化");
        assert!(prepared.changed);
        assert_eq!(
            prepared.document,
            json!({"type":"doc","content":[
                {"type":"paragraph","content":[
                    {"type":"text","text":"a"},
                    {"type":"emoji","attrs":{"name":"smile"}}
                ]}
            ]})
        );
        let second = prepare_document(&prepared.document).expect("幂等");
        assert!(!second.changed, "规范化必须幂等");
    }

    #[test]
    fn markdown_covers_common_blocks() {
        let document = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"标题"}]},
            {"type":"paragraph","content":[
                {"type":"text","text":"粗","marks":[{"type":"bold"}]},
                {"type":"text","text":"与"},
                {"type":"text","text":"码","marks":[{"type":"code"}]},
                {"type":"text","text":"链接","marks":[{"type":"link","attrs":{"href":"https://example.com"}}]}
            ]},
            {"type":"bulletList","content":[
                {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"项"}]}]}
            ]},
            {"type":"taskList","content":[
                {"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"完成"}]}]}
            ]},
            {"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"引用"}]}]},
            {"type":"codeBlock","attrs":{"language":"rust"},"content":[{"type":"text","text":"fn main() {}"}]},
            {"type":"table","content":[
                {"type":"tableRow","content":[
                    {"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"H"}]}]}
                ]},
                {"type":"tableRow","content":[
                    {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"C"}]}]}
                ]}
            ]}
        ]});
        let markdown = to_markdown(&document);
        assert!(markdown.contains("## 标题"));
        assert!(markdown.contains("**粗**"));
        assert!(markdown.contains("`码`"));
        assert!(markdown.contains("[链接](https://example.com)"));
        assert!(markdown.contains("- 项"));
        assert!(markdown.contains("- [x] 完成"));
        assert!(markdown.contains("> 引用"));
        assert!(markdown.contains("```rust\nfn main() {}\n```"));
        assert!(markdown.contains("| H"), "markdown={markdown}");
        assert!(markdown.contains("| C"), "markdown={markdown}");
    }

    #[test]
    fn attachment_nodes_are_counted_and_rendered_in_markdown() {
        let document = json!({"type":"doc","content":[
            {"type":"attachmentImage","attrs":{"attachmentId":"img-1","name":"封面.png","alt":"封面","mime":"image/png"}},
            {"type":"attachmentBlock","attrs":{"variant":"grid","align":"left","items":[
                {"attachmentId":"att-1","name":"报告.pdf","size":10,"mime":"application/pdf"},
                {"attachmentId":"att-2","name":"数据.json","size":20,"mime":"application/json"}
            ]}}
        ]});
        let props = document_props(&document);
        assert_eq!(props["imageCount"], 1);
        assert_eq!(props["attachmentCount"], 2);
        assert_eq!(props["blockCount"], 2);
        let markdown = to_markdown(&document);
        assert!(
            markdown.contains("![封面](attachment://img-1)"),
            "{markdown}"
        );
        assert!(
            markdown.contains("- [报告.pdf](attachment://att-1)"),
            "{markdown}"
        );
        assert!(
            markdown.contains("- [数据.json](attachment://att-2)"),
            "{markdown}"
        );
    }

    #[test]
    fn props_are_valid_json_with_counts() {
        let document = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"标题"}]},
            {"type":"paragraph","content":[{"type":"text","text":"正文"}]}
        ]});
        let props = document_props(&document);
        assert_eq!(props["blockCount"], 2);
        assert_eq!(props["headingCount"], 1);
        assert_eq!(props["wordCount"], 4);
        assert_eq!(props["version"], 1);
        assert!(props.is_object());
    }
}
