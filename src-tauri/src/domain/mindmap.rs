//! 思维导图内容校验与派生数据。
//!
//! 这里是持久化前的最终权威边界：前端可即时反馈，但数据库只接受通过本模块校验的内容。
//! v2 同时接受 schemaVersion 1（旧内容）与 2（含样式/关系线/外框/概要）。

use std::collections::BTreeSet;

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{MindmapContent, MindmapTopic, MindmapTopicStyle};

/// 单张导图允许的最大主题数。5,000 仍可在桌面端保持可交互，超过时明确拒绝。
pub const MAX_TOPICS: usize = 5_000;
/// 最大树深度，防止异常递归导致栈溢出和布局失控。
pub const MAX_DEPTH: usize = 100;
/// 主题文本最大 Unicode 字符数。
const MAX_TEXT_CHARS: usize = 2_000;
/// 备注最大 Unicode 字符数。
const MAX_NOTE_CHARS: usize = 8_000;
/// 单主题标签数量。
const MAX_LABELS: usize = 10;
/// 单个标签长度。
const MAX_LABEL_CHARS: usize = 50;
/// 超链接长度。
const MAX_LINK_CHARS: usize = 2_048;
/// 单主题标记数量。
const MAX_MARKERS: usize = 12;
/// 关系线数量上限。
const MAX_RELATIONSHIPS: usize = 100;
/// 外框数量上限。
const MAX_BOUNDARIES: usize = 50;
/// 概要数量上限。
const MAX_SUMMARIES: usize = 50;
/// 单个外框/概要圈住的主题数上限。
const MAX_GROUP_MEMBERS: usize = 50;
/// 外框/概要标签长度。
const MAX_GROUP_LABEL_CHARS: usize = 200;
/// 自由主题数量上限。
const MAX_FREE_TOPICS: usize = 100;
/// 单主题贴纸数量上限。
const MAX_STICKERS: usize = 8;
/// 手动坐标的绝对值上限（防止异常数据把视口撑爆）。
const MAX_POSITION: f64 = 1_000_000.0;

/// 样式可用色板：32 色（含旧 12 色中的 4 个历史值，保证旧导图可保存）；与前端一致。
pub const STYLE_PALETTE: &[&str] = &[
    "#e05f5f", "#e8873a", "#d9a72e", "#c9a227", "#7fa63c", "#4fae6b", "#3d8a7e", "#2f9e9a",
    "#5b8fb5", "#4f7fd9", "#7c82b8", "#8e5fb5", "#b45aa8", "#d0647f", "#c0554e", "#a87a4a",
    "#8a6a4f", "#2f5c51", "#5c8f83", "#81b29a", "#b08a55", "#7fb0d6", "#64906f", "#626663",
    "#e07a5f", "#f2b84b", "#f2cc8f", "#b06ab3", "#6b8e23", "#4682b4", "#cd5c5c", "#9370db",
];

/// 内置贴纸集合。
pub const ALLOWED_STICKERS: &[&str] = &[
    "check", "idea", "warning", "flame", "target", "pin", "heart", "thumb", "burst", "question",
    "cash", "clock",
];

/// Starris 支持的标记集合；导入未知标记时忽略并返回警告。
pub const ALLOWED_MARKERS: &[&str] = &[
    // 优先级
    "priority-1",
    "priority-2",
    "priority-3",
    "priority-4",
    "priority-5",
    "priority-6",
    // 任务进度
    "progress-0",
    "progress-1",
    "progress-2",
    "progress-3",
    "progress-4",
    "progress-5",
    "progress-6",
    // 旗标与星标（裸 flag 兼容 v1 数据）
    "flag",
    "flag-red",
    "flag-orange",
    "flag-green",
    "flag-blue",
    "flag-purple",
    "star",
    // 符号
    "symbol-check",
    "symbol-cross",
    "symbol-question",
    "symbol-exclamation",
    "symbol-plus",
    "symbol-minus",
    // 表情
    "face-smile",
    "face-grin",
    "face-neutral",
    "face-frown",
    "face-angry",
    // 星期
    "week-mon",
    "week-tue",
    "week-wed",
    "week-thu",
    "week-fri",
    "week-sat",
    "week-sun",
    // 月份
    "month-1",
    "month-2",
    "month-3",
    "month-4",
    "month-5",
    "month-6",
    "month-7",
    "month-8",
    "month-9",
    "month-10",
    "month-11",
    "month-12",
];

/// 校验思维导图并返回主题数（含概要主题）。
///
/// @param content 前端提交的完整场景
/// @returns 主题总数；结构、ID、文本、链接或规模非法时返回校验错误
pub fn validate_content(content: &MindmapContent) -> AppResult<usize> {
    if content.schema_version != 1 && content.schema_version != 2 {
        return Err(AppError::validation("思维导图格式版本不受支持"));
    }
    if !content.sheet.id.starts_with("sheet-") || content.sheet.id.len() < 10 {
        return Err(AppError::validation("思维导图画布标识无效"));
    }
    let mut ids = BTreeSet::new();
    let mut count = validate_topic(&content.sheet.root, 1, &mut ids)?;
    for summary in &content.summaries {
        count = count.saturating_add(validate_topic(&summary.topic, 1, &mut ids)?);
    }
    if content.free_topics.len() > MAX_FREE_TOPICS {
        return Err(AppError::validation("自由主题数量超过上限"));
    }
    for topic in &content.free_topics {
        if topic.pos.is_none() {
            return Err(AppError::validation("自由主题缺少坐标"));
        }
        count = count.saturating_add(validate_topic(topic, 1, &mut ids)?);
    }
    if count > MAX_TOPICS {
        return Err(AppError::validation("思维导图主题数超过上限"));
    }
    if content.summaries.len() > MAX_SUMMARIES {
        return Err(AppError::validation("概要数量超过上限"));
    }
    validate_relationships(content, &ids)?;
    validate_boundaries(content, &ids)?;
    Ok(count)
}

/// 把主题文本、标签和备注展开为检索正文（含概要主题）。
///
/// @param content 已校验场景
/// @returns 以换行分隔、适合 FTS trigram 索引的纯文本
pub fn search_body(content: &MindmapContent) -> String {
    let mut body = String::new();
    collect_search_text(&content.sheet.root, &mut body);
    for summary in &content.summaries {
        collect_search_text(&summary.topic, &mut body);
    }
    for topic in &content.free_topics {
        collect_search_text(topic, &mut body);
    }
    for boundary in &content.boundaries {
        if !boundary.label.trim().is_empty() {
            body.push_str(boundary.label.trim());
            body.push('\n');
        }
    }
    body
}

/// 收集场景引用的附件 object_id（含概要主题图片）。
pub fn collect_image_object_ids(content: &MindmapContent) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    collect_image_ids(&content.sheet.root, &mut ids);
    for summary in &content.summaries {
        collect_image_ids(&summary.topic, &mut ids);
    }
    for topic in &content.free_topics {
        collect_image_ids(topic, &mut ids);
    }
    ids
}

fn validate_topic(
    topic: &MindmapTopic,
    depth: usize,
    ids: &mut BTreeSet<String>,
) -> AppResult<usize> {
    if depth > MAX_DEPTH {
        return Err(AppError::validation("思维导图层级超过上限"));
    }
    if !topic.id.starts_with("topic-") || topic.id.len() < 10 {
        return Err(AppError::validation("思维导图主题标识无效"));
    }
    if !ids.insert(topic.id.clone()) {
        return Err(AppError::validation("思维导图主题标识重复"));
    }
    validate_text(&topic.text, MAX_TEXT_CHARS, false, "主题文本")?;
    validate_text(&topic.note, MAX_NOTE_CHARS, true, "主题备注")?;
    if topic.labels.len() > MAX_LABELS {
        return Err(AppError::validation("单个主题的标签过多"));
    }
    for label in &topic.labels {
        validate_text(label, MAX_LABEL_CHARS, false, "主题标签")?;
        if label.trim().is_empty() {
            return Err(AppError::validation("主题标签不能为空白"));
        }
    }
    validate_link(&topic.link)?;
    if topic.markers.len() > MAX_MARKERS {
        return Err(AppError::validation("单个主题的标记过多"));
    }
    for marker in &topic.markers {
        if !ALLOWED_MARKERS.contains(&marker.as_str()) {
            return Err(AppError::validation("思维导图标记不受支持"));
        }
    }
    if let Some(style) = &topic.style {
        validate_style(style)?;
    }
    if let Some(pos) = &topic.pos
        && (!pos.x.is_finite()
            || !pos.y.is_finite()
            || pos.x.abs() > MAX_POSITION
            || pos.y.abs() > MAX_POSITION)
    {
        return Err(AppError::validation("主题坐标无效"));
    }
    if topic.stickers.len() > MAX_STICKERS {
        return Err(AppError::validation("单个主题的贴纸过多"));
    }
    for sticker in &topic.stickers {
        if !ALLOWED_STICKERS.contains(&sticker.as_str()) {
            return Err(AppError::validation("贴纸不受支持"));
        }
    }
    if let Some(image) = &topic.image {
        if image.object_id.trim().is_empty() {
            return Err(AppError::validation("思维导图图片引用无效"));
        }
        if !image.width.is_finite()
            || !image.height.is_finite()
            || image.width < 1.0
            || image.height < 1.0
            || image.width > 4_096.0
            || image.height > 4_096.0
        {
            return Err(AppError::validation("思维导图图片尺寸无效"));
        }
    }

    let mut count = 1_usize;
    for child in &topic.children {
        count = count.saturating_add(validate_topic(child, depth + 1, ids)?);
        if count > MAX_TOPICS {
            return Err(AppError::validation("思维导图主题数超过上限"));
        }
    }
    Ok(count)
}

fn validate_style(style: &MindmapTopicStyle) -> AppResult<()> {
    validate_style_color(&style.border_color, "边框颜色")?;
    validate_style_color(&style.fill, "填充颜色")?;
    Ok(())
}

/// 颜色值只能是 `auto`、`none`（仅填充）或 12 色板内的十六进制。
fn validate_style_color(value: &str, label: &str) -> AppResult<()> {
    if value.is_empty() || value == "auto" || value == "none" {
        return Ok(());
    }
    if !STYLE_PALETTE.contains(&value.to_ascii_lowercase().as_str()) {
        return Err(AppError::validation(format!("{label}不在可用色板内")));
    }
    Ok(())
}

fn validate_relationships(content: &MindmapContent, ids: &BTreeSet<String>) -> AppResult<()> {
    if content.relationships.len() > MAX_RELATIONSHIPS {
        return Err(AppError::validation("关系线数量超过上限"));
    }
    let mut seen = BTreeSet::new();
    for relationship in &content.relationships {
        if !relationship.id.starts_with("rel-") || relationship.id.len() < 8 {
            return Err(AppError::validation("关系线标识无效"));
        }
        if !seen.insert(relationship.id.clone()) {
            return Err(AppError::validation("关系线标识重复"));
        }
        if !ids.contains(&relationship.from) || !ids.contains(&relationship.to) {
            return Err(AppError::validation("关系线连接的主题不存在"));
        }
        if relationship.from == relationship.to {
            return Err(AppError::validation("关系线不能连接主题自身"));
        }
        validate_text(
            &relationship.label,
            MAX_GROUP_LABEL_CHARS,
            false,
            "关系线标签",
        )?;
        validate_style_color(&relationship.color, "关系线颜色")?;
    }
    Ok(())
}

fn validate_boundaries(content: &MindmapContent, ids: &BTreeSet<String>) -> AppResult<()> {
    if content.boundaries.len() > MAX_BOUNDARIES {
        return Err(AppError::validation("外框数量超过上限"));
    }
    let mut seen = BTreeSet::new();
    for boundary in &content.boundaries {
        validate_group(
            boundary.id.as_str(),
            "bd-",
            &boundary.parent,
            &boundary.child_ids,
            &mut seen,
        )?;
        validate_text(&boundary.label, MAX_GROUP_LABEL_CHARS, false, "外框标签")?;
        validate_style_color(&boundary.color, "外框颜色")?;
        if !ids.contains(&boundary.parent) {
            return Err(AppError::validation("外框的父主题不存在"));
        }
        for child in &boundary.child_ids {
            if !ids.contains(child) {
                return Err(AppError::validation("外框包含不存在的主题"));
            }
        }
    }
    Ok(())
}

/// 外框与概要共用的组成员校验：标识合法、成员数受限、成员互不重复。
fn validate_group(
    id: &str,
    prefix: &str,
    _parent: &str,
    child_ids: &[String],
    seen: &mut BTreeSet<String>,
) -> AppResult<()> {
    if !id.starts_with(prefix) || id.len() < 8 {
        return Err(AppError::validation("分组标识无效"));
    }
    if !seen.insert(id.to_string()) {
        return Err(AppError::validation("分组标识重复"));
    }
    if child_ids.is_empty() || child_ids.len() > MAX_GROUP_MEMBERS {
        return Err(AppError::validation("分组包含的主题数无效"));
    }
    let mut members = BTreeSet::new();
    for child in child_ids {
        if !members.insert(child.clone()) {
            return Err(AppError::validation("分组包含重复主题"));
        }
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize, allow_newline: bool, label: &str) -> AppResult<()> {
    if value.chars().count() > max_chars {
        return Err(AppError::validation(format!("{label}过长")));
    }
    if value.chars().any(|character| {
        character.is_control() && !(allow_newline && matches!(character, '\n' | '\r' | '\t'))
    }) {
        return Err(AppError::validation(format!("{label}包含控制字符")));
    }
    Ok(())
}

fn validate_link(link: &str) -> AppResult<()> {
    if link.is_empty() {
        return Ok(());
    }
    if link.chars().count() > MAX_LINK_CHARS {
        return Err(AppError::validation("主题链接过长"));
    }
    let scheme_end = link
        .find(':')
        .ok_or_else(|| AppError::validation("主题链接协议无效"))?;
    let scheme = &link[..scheme_end];
    if !matches!(scheme, "http" | "https" | "mailto") {
        return Err(AppError::validation("主题链接仅支持 HTTP、HTTPS 或邮件"));
    }
    if link[scheme_end + 1..].trim().is_empty() {
        return Err(AppError::validation("主题链接目标为空"));
    }
    Ok(())
}

fn collect_search_text(topic: &MindmapTopic, body: &mut String) {
    if !topic.text.trim().is_empty() {
        body.push_str(topic.text.trim());
        body.push('\n');
    }
    for label in &topic.labels {
        body.push_str(label);
        body.push('\n');
    }
    if !topic.note.trim().is_empty() {
        body.push_str(topic.note.trim());
        body.push('\n');
    }
    for child in &topic.children {
        collect_search_text(child, body);
    }
}

fn collect_image_ids(topic: &MindmapTopic, ids: &mut BTreeSet<String>) {
    if let Some(image) = &topic.image {
        ids.insert(image.object_id.clone());
    }
    for child in &topic.children {
        collect_image_ids(child, ids);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::mindmap::{
        MindmapBorderShape, MindmapBoundary, MindmapContent, MindmapImage, MindmapRelationship,
        MindmapSheet, MindmapStructure, MindmapSummary, MindmapTheme, MindmapTopic,
        MindmapTopicStyle,
    };

    fn topic(id: &str, children: Vec<MindmapTopic>) -> MindmapTopic {
        MindmapTopic {
            id: id.to_string(),
            text: "主题".to_string(),
            note: String::new(),
            labels: vec!["标签".to_string()],
            link: String::new(),
            markers: vec!["priority-1".to_string()],
            image: None,
            collapsed: false,
            style: None,
            pos: None,
            stickers: Vec::new(),
            children,
        }
    }

    fn content(root: MindmapTopic) -> MindmapContent {
        MindmapContent {
            schema_version: 1,
            sheet: MindmapSheet {
                id: "sheet-test".to_string(),
                structure: MindmapStructure::Balanced,
                theme: MindmapTheme::Auto,
                branch_coloring: Default::default(),
                edge_style: Default::default(),
                background: Default::default(),
                show_numbers: false,
                root,
            },
            relationships: Vec::new(),
            boundaries: Vec::new(),
            summaries: Vec::new(),
            free_topics: Vec::new(),
        }
    }

    #[test]
    fn accepts_valid_tree_and_counts_topics() {
        let count = validate_content(&content(topic(
            "topic-root",
            vec![topic("topic-child", Vec::new())],
        )))
        .expect("valid");
        assert_eq!(count, 2);
    }

    #[test]
    fn rejects_duplicate_ids_and_bad_link() {
        let duplicate = content(topic("topic-root", vec![topic("topic-root", Vec::new())]));
        assert!(validate_content(&duplicate).is_err());
        let mut root = topic("topic-root", Vec::new());
        root.link = "javascript:alert(1)".to_string();
        assert!(validate_content(&content(root)).is_err());
    }

    #[test]
    fn image_ids_and_search_body_are_derived() {
        let mut root = topic("topic-root", vec![topic("topic-child", Vec::new())]);
        root.image = Some(MindmapImage {
            object_id: "object-1".to_string(),
            width: 100.0,
            height: 80.0,
        });
        let value = content(root);
        assert_eq!(collect_image_object_ids(&value).len(), 1);
        let body = search_body(&value);
        assert!(body.contains("主题"));
        assert!(body.contains("标签"));
    }

    #[test]
    fn accepts_v2_style_markers_and_groups() {
        let mut styled = topic("topic-styled", Vec::new());
        styled.style = Some(MindmapTopicStyle {
            border_color: STYLE_PALETTE[0].to_string(),
            border_shape: crate::models::mindmap::MindmapBorderShape::Pill,
            fill: "auto".to_string(),
            border_width: crate::models::mindmap::MindmapBorderWidth::Bold,
        });
        styled.markers = vec![
            "progress-3".to_string(),
            "face-smile".to_string(),
            "week-mon".to_string(),
        ];
        let mut value = content(topic(
            "topic-root",
            vec![styled, topic("topic-beta", Vec::new())],
        ));
        value.schema_version = 2;
        value.relationships = vec![MindmapRelationship {
            id: "rel-11111".to_string(),
            from: "topic-root".to_string(),
            to: "topic-beta".to_string(),
            label: "依赖".to_string(),
            color: "auto".to_string(),
        }];
        value.boundaries = vec![MindmapBoundary {
            id: "bd-111111".to_string(),
            parent: "topic-root".to_string(),
            child_ids: vec!["topic-beta".to_string()],
            label: "阶段一".to_string(),
            color: "auto".to_string(),
        }];
        value.summaries = vec![MindmapSummary {
            id: "sum-11111".to_string(),
            parent: "topic-root".to_string(),
            child_ids: vec!["topic-beta".to_string()],
            topic: topic("topic-summary", Vec::new()),
        }];
        let count = validate_content(&value).expect("v2 合法");
        assert_eq!(count, 4, "树 3 主题 + 概要主题");
        let body = search_body(&value);
        assert!(body.contains("阶段一"), "外框标签进入检索正文");
        assert!(collect_image_object_ids(&value).is_empty());
    }

    #[test]
    fn rejects_bad_group_and_relationship_references() {
        let mut value = content(topic("topic-root", vec![topic("topic-beta", Vec::new())]));
        value.schema_version = 2;
        value.boundaries = vec![MindmapBoundary {
            id: "bd-111111".to_string(),
            parent: "topic-root".to_string(),
            child_ids: vec!["topic-missing".to_string()],
            label: String::new(),
            color: "auto".to_string(),
        }];
        assert!(validate_content(&value).is_err(), "外框成员不存在应拒绝");

        let mut value = content(topic("topic-root", vec![topic("topic-beta", Vec::new())]));
        value.schema_version = 2;
        value.relationships = vec![MindmapRelationship {
            id: "rel-11111".to_string(),
            from: "topic-root".to_string(),
            to: "topic-root".to_string(),
            label: String::new(),
            color: "auto".to_string(),
        }];
        assert!(validate_content(&value).is_err(), "自连关系线应拒绝");

        let mut value = content(topic("topic-root", Vec::new()));
        value.schema_version = 2;
        let mut styled = topic("topic-styled", Vec::new());
        styled.style = Some(MindmapTopicStyle {
            border_color: "#ff00ff".to_string(),
            border_shape: MindmapBorderShape::Rounded,
            fill: "auto".to_string(),
            border_width: crate::models::mindmap::MindmapBorderWidth::Normal,
        });
        value.sheet.root = styled;
        assert!(validate_content(&value).is_err(), "色板外颜色应拒绝");
    }

    #[test]
    fn free_topics_require_position_and_join_totals() {
        let mut value = content(topic("topic-root", Vec::new()));
        value.schema_version = 2;
        let mut free = topic("topic-free0001", Vec::new());
        free.pos = Some(crate::models::mindmap::MindmapPosition { x: 420.0, y: -80.0 });
        free.stickers = vec!["idea".to_string(), "pin".to_string()];
        value.free_topics = vec![free];
        let count = validate_content(&value).expect("自由主题合法");
        assert_eq!(count, 2);
        assert!(search_body(&value).contains("主题"));

        let mut missing = content(topic("topic-root", Vec::new()));
        missing.schema_version = 2;
        missing.free_topics = vec![topic("topic-free0002", Vec::new())];
        assert!(validate_content(&missing).is_err(), "自由主题缺坐标应拒绝");

        let mut bad_sticker = content(topic("topic-root", Vec::new()));
        bad_sticker.schema_version = 2;
        let mut styled = topic("topic-stick0001", Vec::new());
        styled.stickers = vec!["unknown".to_string()];
        bad_sticker.sheet.root = styled;
        assert!(validate_content(&bad_sticker).is_err(), "未知贴纸应拒绝");
    }

    #[test]
    fn v1_content_without_new_fields_still_valid() {
        let raw = r#"{
            "schemaVersion": 1,
            "sheet": {
                "id": "sheet-legacy001",
                "structure": "balanced",
                "theme": "auto",
                "root": { "id": "topic-legacy001", "text": "旧内容", "children": [] }
            }
        }"#;
        let parsed: MindmapContent = serde_json::from_str(raw).expect("v1 JSON 可解析");
        validate_content(&parsed).expect("v1 内容可校验");
        assert_eq!(parsed.sheet.branch_coloring, Default::default());
    }
}
