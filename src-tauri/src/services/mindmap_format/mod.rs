//! 思维导图行业格式转换。
//!
//! 所有外部文件均先转换成 canonical `MindmapContent`，再由 mindmap_service 校验和落库。
//! 本模块不访问数据库，只负责格式识别、解析与序列化。

pub mod freemind;
pub mod markdown;
pub mod native;
pub mod opml;
pub mod xmind;

use std::path::Path;

use quick_xml::XmlVersion;
use quick_xml::events::BytesStart;
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{
    MindmapContent, MindmapSheet, MindmapStructure, MindmapTheme, MindmapTopic,
};

/// 可识别的思维导图文件格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapFormat {
    Xmind,
    Freemind,
    Opml,
    Markdown,
    Native,
}

impl MindmapFormat {
    /// 按扩展名识别格式。
    pub fn from_path(path: &Path) -> Option<Self> {
        match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "xmind" => Some(Self::Xmind),
            "mm" => Some(Self::Freemind),
            "opml" => Some(Self::Opml),
            "md" | "markdown" | "mdown" | "mkd" => Some(Self::Markdown),
            "json" => Some(Self::Native),
            _ => None,
        }
    }

    /// 导出扩展名。
    pub fn extension(self) -> &'static str {
        match self {
            Self::Xmind => "xmind",
            Self::Freemind => "mm",
            Self::Opml => "opml",
            Self::Markdown => "md",
            Self::Native => "starris-mindmap.json",
        }
    }
}

/// 一个导入画布。图片以资源名暂存，由导入服务上传后替换 object_id。
#[derive(Debug, Clone)]
pub struct ImportedMindmap {
    pub title: String,
    pub content: MindmapContent,
    pub warnings: Vec<String>,
    pub image_resources: Vec<(String, Vec<u8>, String)>,
}

/// 一个导出文件。
#[derive(Debug, Clone)]
pub struct ExportedMindmapFile {
    pub bytes: Vec<u8>,
}

/// 图片导出回调：object_id →（字节、扩展名）。
pub type ImageLoader<'a> = &'a dyn Fn(&str) -> AppResult<(Vec<u8>, String)>;

/// 解析一个思维导图文件；多画布返回多个结果。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let format = MindmapFormat::from_path(path)
        .ok_or_else(|| AppError::validation("不支持的思维导图文件扩展名"))?;
    match format {
        MindmapFormat::Xmind => xmind::parse(path),
        MindmapFormat::Freemind => freemind::parse(path),
        MindmapFormat::Opml => opml::parse(path),
        MindmapFormat::Markdown => markdown::parse(path),
        MindmapFormat::Native => native::parse(path),
    }
}

/// 导出一个画布。
pub fn export(
    content: &MindmapContent,
    title: &str,
    format: MindmapFormat,
    image_loader: Option<ImageLoader<'_>>,
) -> AppResult<ExportedMindmapFile> {
    let bytes = match format {
        MindmapFormat::Xmind => {
            let loader =
                image_loader.ok_or_else(|| AppError::validation("XMind 导出缺少图片读取器"))?;
            xmind::export(content, title, loader)?
        }
        MindmapFormat::Freemind => freemind::export(content, title)?,
        MindmapFormat::Opml => opml::export(content, title)?,
        MindmapFormat::Markdown => markdown::export(content, title),
        MindmapFormat::Native => native::export(content)?,
    };
    Ok(ExportedMindmapFile { bytes })
}

/// 用上传结果替换导入资源名。
pub fn replace_image_object_ids(
    content: &mut MindmapContent,
    replacements: &std::collections::BTreeMap<String, String>,
) {
    replace_topic_images(&mut content.sheet.root, replacements);
}

fn replace_topic_images(
    topic: &mut MindmapTopic,
    replacements: &std::collections::BTreeMap<String, String>,
) {
    // 空替换值表示该资源导入失败：整张图片一起丢弃，避免持久化出无效引用
    // （校验层会拒绝空 objectId，进而让整张画布保存失败）。
    let replacement = topic
        .image
        .as_ref()
        .and_then(|image| replacements.get(&image.object_id))
        .cloned();
    if let Some(object_id) = replacement {
        if object_id.is_empty() {
            topic.image = None;
        } else if let Some(image) = topic.image.as_mut() {
            image.object_id = object_id;
        }
    }
    for child in &mut topic.children {
        replace_topic_images(child, replacements);
    }
}

/// 把 canonical 结构序列化为稳定 JSON，供 Native 与 manifest 使用。
pub fn content_value(content: &MindmapContent) -> Value {
    serde_json::to_value(content).unwrap_or_else(|_| json!({}))
}

/// 从 Native JSON 值反序列化并校验。
pub fn content_from_value(value: Value) -> AppResult<MindmapContent> {
    serde_json::from_value(value)
        .map_err(|error| AppError::validation(format!("思维导图 JSON 无效：{error}")))
}

/// 从 XMind/FreeMind 等外部 id 生成 Starris 安全 id。
pub fn stable_topic_id(source: Option<&str>) -> String {
    let source = source.unwrap_or_default();
    let normalized: String = source
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(64)
        .collect();
    if normalized.len() >= 12 {
        format!("topic-{normalized}")
    } else {
        format!("topic-{}", crate::utils::new_id())
    }
}

/// 从外部 sheet id 生成 Starris 安全 id。
pub fn stable_sheet_id(source: Option<&str>) -> String {
    let source = source.unwrap_or_default();
    let normalized: String = source
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(64)
        .collect();
    if normalized.len() >= 12 {
        format!("sheet-{normalized}")
    } else {
        format!("sheet-{}", crate::utils::new_id())
    }
}

/// 从结构字符串选择 Starris 布局。
pub fn structure_from_xmind(value: Option<&str>) -> MindmapStructure {
    match value.unwrap_or_default() {
        "org.xmind.ui.logic.right" => MindmapStructure::LogicRight,
        "org.xmind.ui.logic.left" => MindmapStructure::LogicLeft,
        "org.xmind.ui.org-chart.down" => MindmapStructure::OrgDown,
        "org.xmind.ui.org-chart.up" => MindmapStructure::OrgUp,
        "org.xmind.ui.tree.right" | "org.xmind.ui.tree.left" => MindmapStructure::Tree,
        "org.xmind.ui.timeline.horizontal" => MindmapStructure::Timeline,
        "org.xmind.ui.fishbone" => MindmapStructure::Fishbone,
        _ => MindmapStructure::Balanced,
    }
}

/// XMind 导出使用的 structureClass。
pub fn xmind_structure_class(structure: MindmapStructure) -> &'static str {
    match structure {
        MindmapStructure::Balanced => "org.xmind.ui.map.unbalanced",
        MindmapStructure::LogicRight => "org.xmind.ui.logic.right",
        MindmapStructure::LogicLeft => "org.xmind.ui.logic.left",
        MindmapStructure::OrgDown => "org.xmind.ui.org-chart.down",
        MindmapStructure::OrgUp => "org.xmind.ui.org-chart.up",
        MindmapStructure::Tree => "org.xmind.ui.tree.right",
        MindmapStructure::Timeline => "org.xmind.ui.timeline.horizontal",
        MindmapStructure::Fishbone => "org.xmind.ui.fishbone",
    }
}

/// 从 XMind markerId 映射到 Starris 标记。
pub fn marker_from_xmind(value: &str) -> Option<&'static str> {
    match value {
        "priority-1" => Some("priority-1"),
        "priority-2" => Some("priority-2"),
        "priority-3" => Some("priority-3"),
        "priority-4" => Some("priority-4"),
        "priority-5" => Some("priority-5"),
        "task-start" => Some("progress-0"),
        "task-half" => Some("progress-3"),
        "task-oct" => Some("progress-5"),
        "task-done" => Some("progress-6"),
        "flag-red" | "flag" => Some("flag"),
        "star-red" | "star" => Some("star"),
        _ => None,
    }
}

/// Starris 标记映射回常见 XMind markerId。
pub fn xmind_marker_id(value: &str) -> Option<&'static str> {
    match value {
        "priority-1" => Some("priority-1"),
        "priority-2" => Some("priority-2"),
        "priority-3" => Some("priority-3"),
        "priority-4" => Some("priority-4"),
        "priority-5" => Some("priority-5"),
        "progress-0" => Some("task-start"),
        "progress-3" => Some("task-half"),
        "progress-5" => Some("task-oct"),
        "progress-6" => Some("task-done"),
        "flag" => Some("flag-red"),
        "star" => Some("star-red"),
        _ => None,
    }
}

/// 去除 HTML 标签，保留换行和实体解码结果。
pub fn html_to_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut inside_tag = false;
    let mut entities = String::new();
    let chars: Vec<char> = value.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let character = chars[index];
        if character == '<' {
            inside_tag = true;
            if text.ends_with('>') {
                text.push('\n');
            }
        } else if character == '>' {
            inside_tag = false;
            text.push(' ');
        } else if !inside_tag {
            if character == '&' {
                let end = chars[index..]
                    .iter()
                    .position(|item| *item == ';')
                    .map(|position| index + position)
                    .unwrap_or(index + 10)
                    .min(chars.len().saturating_sub(1));
                entities.clear();
                entities.extend(&chars[index + 1..end]);
                let decoded = match entities.as_str() {
                    "amp" => Some("&"),
                    "lt" => Some("<"),
                    "gt" => Some(">"),
                    "quot" => Some("\""),
                    "apos" => Some("'"),
                    "nbsp" => Some(" "),
                    _ => None,
                };
                if let Some(decoded) = decoded {
                    text.push_str(decoded);
                    index = end + 1;
                    continue;
                }
            }
            text.push(character);
        }
        index += 1;
    }
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace("\\n", "\n")
}

/// 转义 XML 文本。
pub fn xml_escape(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' => output.push_str("&quot;"),
            '\'' => output.push_str("&apos;"),
            _ => output.push(character),
        }
    }
    output
}

/// 转义 XML 属性。
pub fn xml_attribute(value: &str) -> String {
    xml_escape(value)
        .replace('\n', "&#10;")
        .replace('\t', "&#9;")
}

/// 创建默认主题。
pub fn new_topic(text: String) -> MindmapTopic {
    MindmapTopic {
        id: format!("topic-{}", crate::utils::new_id()),
        text,
        note: String::new(),
        labels: Vec::new(),
        link: String::new(),
        markers: Vec::new(),
        image: None,
        collapsed: false,
        style: None,
        pos: None,
        stickers: Vec::new(),
        children: Vec::new(),
    }
}

/// 创建默认画布。
pub fn new_sheet(root: MindmapTopic, structure: MindmapStructure) -> MindmapContent {
    MindmapContent {
        schema_version: 2,
        sheet: MindmapSheet {
            id: format!("sheet-{}", crate::utils::new_id()),
            structure,
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

/// 收集场景引用的图片 object_id。
pub fn image_object_ids(content: &MindmapContent) -> std::collections::BTreeSet<String> {
    crate::domain::mindmap::collect_image_object_ids(content)
}

/// 从 JSON object 安全取字符串。
pub fn json_string(object: &Map<String, Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.to_string())
}

/// 从 JSON object 安全取数字。
pub fn json_f64(object: &Map<String, Value>, key: &str) -> Option<f64> {
    object.get(key).and_then(Value::as_f64)
}

/// 从 JSON object 取字符串数组。
pub fn json_strings(object: &Map<String, Value>, key: &str) -> Vec<String> {
    object
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .take(10)
                .collect()
        })
        .unwrap_or_default()
}

/// 从 XML 开始标签读取属性。
pub fn xml_attribute_value(element: &BytesStart<'_>, key: &str) -> Option<String> {
    element
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.as_ref() == key)
        .and_then(|attribute| attribute.normalized_value(XmlVersion::Implicit1_0).ok())
        .map(|value| value.into_owned())
}

/// 从 XML 开始标签读取带命名空间后缀的属性（例如 xlink:href）。
pub fn xml_attribute_suffix(element: &BytesStart<'_>, suffix: &str) -> Option<String> {
    element
        .attributes()
        .flatten()
        .find(|attribute| attribute.key.as_ref().ends_with(suffix))
        .and_then(|attribute| attribute.normalized_value(XmlVersion::Implicit1_0).ok())
        .map(|value| value.into_owned())
}
