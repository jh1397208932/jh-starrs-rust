//! Markdown 大纲与思维导图互转。
//!
//! 这里采用行级大纲解析，而不是完整 CommonMark 文档解析：标题与缩进列表构成树，
//! 段落追加为最近主题的备注，代码块明确跳过并警告。

use std::fs;
use std::path::Path;

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{MindmapContent, MindmapStructure, MindmapTopic};
use crate::services::mindmap_format::{ImportedMindmap, new_sheet, new_topic};

struct Entry {
    depth: usize,
    topic: MindmapTopic,
}

/// 解析 Markdown 大纲。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let bytes = fs::read(path)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::validation("Markdown 文件过大"));
    }
    let text =
        String::from_utf8(bytes).map_err(|_| AppError::validation("Markdown 必须是 UTF-8"))?;
    let file_title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Markdown 大纲")
        .to_string();
    let mut entries: Vec<Entry> = Vec::new();
    let mut skipped_code_blocks = 0_usize;
    let mut in_code = false;
    let mut code_fence = String::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            if in_code && trimmed.starts_with(&code_fence) {
                in_code = false;
                code_fence.clear();
            } else if !in_code {
                in_code = true;
                code_fence = if trimmed.starts_with("```") {
                    "```".to_string()
                } else {
                    "~~~".to_string()
                };
                skipped_code_blocks += 1;
            }
            continue;
        }
        if in_code {
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        if let Some((depth, raw)) = heading(trimmed) {
            let (topic_text, link) = clean_inline(raw);
            let mut topic = new_topic(topic_text);
            topic.link = link.unwrap_or_default();
            entries.push(Entry { depth, topic });
            continue;
        }
        if let Some((depth, raw)) = list_item(line) {
            let (topic_text, link) = clean_inline(raw);
            let mut topic = new_topic(topic_text);
            topic.link = link.unwrap_or_default();
            entries.push(Entry { depth, topic });
            continue;
        }
        let (note_text, link) = clean_inline(trimmed);
        if let Some(entry) = entries.last_mut() {
            if !entry.topic.note.is_empty() {
                entry.topic.note.push('\n');
            }
            entry.topic.note.push_str(&note_text);
            if let Some(link) = link.filter(|value| !value.is_empty())
                && entry.topic.link.is_empty()
            {
                entry.topic.link = link;
            }
        }
    }

    if entries.is_empty() {
        return Err(AppError::validation("Markdown 没有可导入的标题或列表项"));
    }
    let mut roots = build_tree(entries);
    let root = if roots.len() == 1 {
        roots.remove(0)
    } else {
        let mut root = new_topic(file_title);
        root.children = roots;
        root
    };
    let mut warnings = Vec::new();
    if skipped_code_blocks > 0 {
        warnings.push(format!("已跳过 {skipped_code_blocks} 个代码块。"));
    }
    warnings.push("Markdown 导入仅识别标题、缩进列表和段落备注。".to_string());
    Ok(vec![ImportedMindmap {
        title: root.text.clone(),
        content: new_sheet(root, MindmapStructure::Balanced),
        warnings,
        image_resources: Vec::new(),
    }])
}

/// 写 Markdown 大纲。
pub fn export(content: &MindmapContent, _title: &str) -> Vec<u8> {
    let mut output = String::new();
    output.push_str("# ");
    output.push_str(&escape_markdown(&content.sheet.root.text));
    output.push('\n');
    if !content.sheet.root.note.is_empty() {
        write_note(&mut output, &content.sheet.root.note, 0);
    }
    for child in &content.sheet.root.children {
        write_topic(&mut output, child, 1);
    }
    output.into_bytes()
}

fn write_topic(output: &mut String, topic: &MindmapTopic, depth: usize) {
    let indent = "  ".repeat(depth.saturating_sub(1));
    output.push_str(&indent);
    output.push_str("- ");
    let text = escape_markdown(&topic.text);
    if !topic.link.is_empty() {
        output.push_str(&format!("[{text}]({})", topic.link));
    } else {
        output.push_str(&text);
    }
    if !topic.labels.is_empty() {
        output.push_str(&format!(" [{}]", topic.labels.join(", ")));
    }
    if !topic.markers.is_empty() {
        output.push_str(&format!(" ({})", topic.markers.join(", ")));
    }
    output.push('\n');
    if !topic.note.is_empty() {
        write_note(output, &topic.note, depth + 1);
    }
    for child in &topic.children {
        write_topic(output, child, depth + 1);
    }
}

fn write_note(output: &mut String, note: &str, depth: usize) {
    let indent = "  ".repeat(depth.saturating_sub(1));
    for line in note.lines() {
        output.push_str(&indent);
        output.push_str("> ");
        output.push_str(line);
        output.push('\n');
    }
}

fn heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.bytes().take_while(|byte| *byte == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = line[hashes..].trim();
    if rest.is_empty() {
        None
    } else {
        Some((hashes - 1, rest))
    }
}

fn list_item(line: &str) -> Option<(usize, &str)> {
    let indent = line.len() - line.trim_start().len();
    let normalized_indent = indent.min(24) / 2;
    let content = line.trim_start();
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = content.strip_prefix(marker) {
            return Some((normalized_indent + 1, rest.trim()));
        }
    }
    let ordered_end = content
        .bytes()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if ordered_end > 0
        && let Some(rest) = content[ordered_end..].strip_prefix(". ")
    {
        return Some((normalized_indent + 1, rest.trim()));
    }
    None
}

fn build_tree(entries: Vec<Entry>) -> Vec<MindmapTopic> {
    let mut roots = Vec::new();
    let mut stack: Vec<(usize, MindmapTopic)> = Vec::new();
    for entry in entries {
        while stack.last().is_some_and(|(depth, _)| *depth >= entry.depth) {
            let (depth, topic) = stack.pop().expect("stack checked");
            attach(&mut stack, &mut roots, topic, depth);
        }
        stack.push((entry.depth, entry.topic));
    }
    while let Some((depth, topic)) = stack.pop() {
        attach(&mut stack, &mut roots, topic, depth);
    }
    roots.reverse();
    roots
}

fn attach(
    stack: &mut [(usize, MindmapTopic)],
    roots: &mut Vec<MindmapTopic>,
    topic: MindmapTopic,
    depth: usize,
) {
    if depth == 0 {
        roots.push(topic);
    } else if let Some((_, parent)) = stack.last_mut() {
        parent.children.push(topic);
    } else {
        roots.push(topic);
    }
}

fn clean_inline(value: &str) -> (String, Option<String>) {
    let mut link = None;
    let mut text = String::new();
    let bytes: Vec<char> = value.chars().collect();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == '!'
            && bytes.get(index + 1) == Some(&'[')
            && let Some((label, end)) = read_link(&bytes, index + 1)
        {
            text.push_str(&label);
            index = end;
            continue;
        }
        if bytes[index] == '['
            && let Some((label, target, end)) = read_link_with_target(&bytes, index)
        {
            text.push_str(&label);
            link = Some(target);
            index = end;
            continue;
        }
        if !matches!(bytes[index], '*' | '_' | '`' | '~') {
            text.push(bytes[index]);
        }
        index += 1;
    }
    (text.trim().to_string(), link)
}

fn read_link(chars: &[char], start: usize) -> Option<(String, usize)> {
    let (label, _, end) = read_link_with_target(chars, start)?;
    Some((label, end))
}

fn read_link_with_target(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    let close = chars[start..]
        .iter()
        .position(|character| *character == ']')
        .map(|position| start + position)?;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let target_end = chars[close + 1..]
        .iter()
        .position(|character| *character == ')')
        .map(|position| close + 1 + position)?;
    let label: String = chars[start + 1..close].iter().collect();
    let target: String = chars[close + 2..target_end].iter().collect();
    Some((label, target, target_end + 1))
}

fn escape_markdown(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}
