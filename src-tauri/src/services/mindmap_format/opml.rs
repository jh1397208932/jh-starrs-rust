//! OPML 2.0 导入导出。

use std::fs;
use std::io::Cursor;
use std::path::Path;

use quick_xml::events::{BytesEnd, BytesStart, BytesText, Event};
use quick_xml::reader::Reader;
use quick_xml::writer::Writer;

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{MindmapContent, MindmapTopic};
use crate::services::mindmap_format::{
    ImportedMindmap, html_to_text, new_sheet, new_topic, xml_attribute, xml_attribute_value,
};

/// 解析 OPML。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let bytes = fs::read(path)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::validation("OPML 文件过大"));
    }
    let text = String::from_utf8(bytes).map_err(|_| AppError::validation("OPML 必须是 UTF-8"))?;
    let mut reader = Reader::from_str(&text);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<(MindmapTopic, Vec<MindmapTopic>)> = Vec::new();
    let mut roots: Vec<MindmapTopic> = Vec::new();
    let mut warnings = Vec::new();

    loop {
        match reader
            .read_event()
            .map_err(|error| AppError::validation(format!("OPML 解析失败：{error}")))?
        {
            Event::Start(element) if element.name().as_ref() == "outline" => {
                let title = xml_attribute_value(&element, "text")
                    .or_else(|| xml_attribute_value(&element, "title"))
                    .unwrap_or_default();
                let note = xml_attribute_value(&element, "_note")
                    .or_else(|| xml_attribute_value(&element, "note"))
                    .map(|value| html_to_text(&value))
                    .unwrap_or_default();
                let link = xml_attribute_value(&element, "url").unwrap_or_default();
                let mut topic = new_topic(title);
                topic.note = note;
                topic.link = normalize_link(&link);
                stack.push((topic, Vec::new()));
            }
            Event::End(element) if element.name().as_ref() == "outline" => {
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
            Event::Eof => break,
            _ => {}
        }
        if stack.len() + roots.len() > 5_000 {
            return Err(AppError::validation("OPML 主题数超过上限"));
        }
    }

    if roots.is_empty() {
        return Err(AppError::validation("OPML 没有可导入的主题"));
    }
    let content = if roots.len() == 1 {
        new_sheet(
            roots.remove(0),
            crate::models::mindmap::MindmapStructure::Balanced,
        )
    } else {
        let mut root = new_topic(
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("OPML 大纲")
                .to_string(),
        );
        root.children = roots;
        new_sheet(root, crate::models::mindmap::MindmapStructure::Balanced)
    };
    warnings.push("OPML 仅保留层级、文本、备注和 URL；样式与折叠状态无法表示。".to_string());
    Ok(vec![ImportedMindmap {
        title: content.sheet.root.text.clone(),
        content,
        warnings,
        image_resources: Vec::new(),
    }])
}

/// 写 OPML 2.0。
pub fn export(content: &MindmapContent, title: &str) -> AppResult<Vec<u8>> {
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    writer
        .write_event(Event::Decl(quick_xml::events::BytesDecl::new(
            "1.0",
            Some("UTF-8"),
            None,
        )))
        .map_err(|_| AppError::Internal)?;
    let mut opml = BytesStart::new("opml");
    opml.push_attribute(("version", "2.0"));
    writer
        .write_event(Event::Start(opml))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::Start(BytesStart::new("head")))
        .map_err(|_| AppError::Internal)?;
    write_text_element(&mut writer, "title", title)?;
    writer
        .write_event(Event::End(BytesEnd::new("head")))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::Start(BytesStart::new("body")))
        .map_err(|_| AppError::Internal)?;
    write_topic(&mut writer, &content.sheet.root)?;
    writer
        .write_event(Event::End(BytesEnd::new("body")))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::End(BytesEnd::new("opml")))
        .map_err(|_| AppError::Internal)?;
    Ok(writer.into_inner().into_inner())
}

fn write_topic(writer: &mut Writer<Cursor<Vec<u8>>>, topic: &MindmapTopic) -> AppResult<()> {
    let mut element = BytesStart::new("outline");
    element.push_attribute(("text", xml_attribute(&topic.text).as_str()));
    if !topic.note.is_empty() {
        element.push_attribute(("_note", xml_attribute(&topic.note).as_str()));
    }
    if !topic.link.is_empty() {
        element.push_attribute(("url", xml_attribute(&topic.link).as_str()));
    }
    writer
        .write_event(Event::Start(element))
        .map_err(|_| AppError::Internal)?;
    for child in &topic.children {
        write_topic(writer, child)?;
    }
    writer
        .write_event(Event::End(BytesEnd::new("outline")))
        .map_err(|_| AppError::Internal)?;
    Ok(())
}

fn write_text_element(
    writer: &mut Writer<Cursor<Vec<u8>>>,
    name: &str,
    value: &str,
) -> AppResult<()> {
    writer
        .write_event(Event::Start(BytesStart::new(name)))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::Text(BytesText::new(value)))
        .map_err(|_| AppError::Internal)?;
    writer
        .write_event(Event::End(BytesEnd::new(name)))
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
