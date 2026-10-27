//! FreeMind `.mm` 导入导出。

use std::fs;
use std::io::Cursor;
use std::path::Path;

use quick_xml::XmlVersion;
use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{MindmapContent, MindmapStructure, MindmapTopic};
use crate::services::mindmap_format::{
    ImportedMindmap, new_sheet, new_topic, xml_attribute, xml_attribute_value,
};

/// 解析 FreeMind XML。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let bytes = fs::read(path)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::validation("FreeMind 文件过大"));
    }
    let text =
        String::from_utf8(bytes).map_err(|_| AppError::validation("FreeMind 必须是 UTF-8"))?;
    let mut reader = Reader::from_str(&text);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<(MindmapTopic, Vec<MindmapTopic>)> = Vec::new();
    let mut roots = Vec::new();
    let mut note_mode = false;
    let mut note_text = String::new();
    let mut warnings = Vec::new();

    loop {
        match reader
            .read_event()
            .map_err(|error| AppError::validation(format!("FreeMind 解析失败：{error}")))?
        {
            Event::Start(element) => {
                let name = element.name();
                if name.as_ref() == "node" {
                    let mut topic =
                        new_topic(xml_attribute_value(&element, "TEXT").unwrap_or_default());
                    topic.collapsed = xml_attribute_value(&element, "FOLDED")
                        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
                    topic.link = normalize_link(
                        xml_attribute_value(&element, "LINK")
                            .unwrap_or_default()
                            .as_str(),
                    );
                    stack.push((topic, Vec::new()));
                } else if name.as_ref() == "richcontent" {
                    note_mode =
                        xml_attribute_value(&element, "TYPE").is_some_and(|value| value == "NOTE");
                    note_text.clear();
                } else if name.as_ref() == "icon" {
                    warnings.push("FreeMind 图标暂不映射为 Starris 标记。".to_string());
                }
            }
            Event::Text(event) if note_mode => {
                note_text.push_str(&event.xml_content(XmlVersion::Implicit1_0));
            }
            Event::End(element) => {
                let name = element.name();
                if name.as_ref() == "richcontent" && note_mode {
                    if let Some((topic, _)) = stack.last_mut() {
                        topic.note = note_text.trim().to_string();
                    }
                    note_mode = false;
                } else if name.as_ref() == "node" {
                    let Some((mut topic, children)) = stack.pop() else {
                        continue;
                    };
                    topic.children = children;
                    if let Some((_, siblings)) = stack.last_mut() {
                        siblings.push(topic);
                    } else {
                        roots.push(topic);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
        if roots.len() + stack.len() > 5_000 {
            return Err(AppError::validation("FreeMind 主题数超过上限"));
        }
    }

    let root = roots
        .into_iter()
        .next()
        .ok_or_else(|| AppError::validation("FreeMind 文件没有根节点"))?;
    warnings.sort();
    warnings.dedup();
    Ok(vec![ImportedMindmap {
        title: root.text.clone(),
        content: new_sheet(root, MindmapStructure::Balanced),
        warnings,
        image_resources: Vec::new(),
    }])
}

/// 写 FreeMind 1.0.1 XML。
pub fn export(content: &MindmapContent, title: &str) -> AppResult<Vec<u8>> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    writer
        .write_event(Event::Decl(quick_xml::events::BytesDecl::new(
            "1.0",
            Some("UTF-8"),
            None,
        )))
        .map_err(|_| AppError::Internal)?;
    let mut map = BytesStart::new("map");
    map.push_attribute(("version", "1.0.1"));
    writer
        .write_event(Event::Start(map))
        .map_err(|_| AppError::Internal)?;
    write_topic(
        &mut writer,
        &content.sheet.root,
        content.sheet.structure,
        true,
        0,
    )?;
    writer
        .write_event(Event::End(BytesEnd::new("map")))
        .map_err(|_| AppError::Internal)?;
    let _ = title;
    Ok(writer.into_inner().into_inner())
}

fn write_topic(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    topic: &MindmapTopic,
    structure: MindmapStructure,
    is_root: bool,
    sibling_index: usize,
) -> AppResult<()> {
    let mut element = BytesStart::new("node");
    element.push_attribute(("TEXT", xml_attribute(&topic.text).as_str()));
    if topic.collapsed {
        element.push_attribute(("FOLDED", "true"));
    }
    if !is_root {
        match structure {
            MindmapStructure::Balanced => {
                element.push_attribute((
                    "POSITION",
                    if sibling_index.is_multiple_of(2) {
                        "right"
                    } else {
                        "left"
                    },
                ));
            }
            MindmapStructure::LogicRight | MindmapStructure::Tree => {
                element.push_attribute(("POSITION", "right"));
            }
            MindmapStructure::LogicLeft => element.push_attribute(("POSITION", "left")),
            MindmapStructure::OrgDown
            | MindmapStructure::OrgUp
            | MindmapStructure::Timeline
            | MindmapStructure::Fishbone => {}
        }
    }
    writer
        .write_event(Event::Start(element))
        .map_err(|_| AppError::Internal)?;
    if !topic.link.is_empty() {
        let mut link = BytesStart::new("link");
        link.push_attribute(("href", xml_attribute(&topic.link).as_str()));
        writer
            .write_event(Event::Empty(link))
            .map_err(|_| AppError::Internal)?;
    }
    let note = combined_note(topic);
    if !note.is_empty() {
        write_rich_note(writer, &note)?;
    }
    for (index, child) in topic.children.iter().enumerate() {
        write_topic(writer, child, structure, false, index)?;
    }
    writer
        .write_event(Event::End(BytesEnd::new("node")))
        .map_err(|_| AppError::Internal)?;
    Ok(())
}

fn combined_note(topic: &MindmapTopic) -> String {
    let mut parts = Vec::new();
    if !topic.note.is_empty() {
        parts.push(topic.note.clone());
    }
    if !topic.labels.is_empty() {
        parts.push(format!("标签：{}", topic.labels.join("、")));
    }
    if !topic.markers.is_empty() {
        parts.push(format!("标记：{}", topic.markers.join("、")));
    }
    parts.join("\n")
}

fn write_rich_note(writer: &mut Writer<Cursor<Vec<u8>>>, note: &str) -> AppResult<()> {
    let mut rich = BytesStart::new("richcontent");
    rich.push_attribute(("TYPE", "NOTE"));
    writer
        .write_event(Event::Start(rich))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::Start(BytesStart::new("plain")))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::Text(BytesText::new(&xml_attribute(note))))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::End(BytesEnd::new("plain")))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::End(BytesEnd::new("richcontent")))
        .map_err(|_| AppError::Internal)?;
    Ok(())
}

fn normalize_link(value: &str) -> String {
    let value = value.trim();
    if value.starts_with("http://") || value.starts_with("https://") || value.starts_with("mailto:")
    {
        value.to_string()
    } else {
        String::new()
    }
}
