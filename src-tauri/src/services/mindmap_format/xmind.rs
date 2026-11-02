//! XMind `.xmind` 导入导出。
//!
//! 导入同时支持 XMind 2020+ 的 `content.json` 与 XMind 8 的 `content.xml`；
//! 导出写现代 `content.json` ZIP，不复制 XMind 的任何代码或资源。

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Cursor, Read, Write};
use std::path::Path;

use quick_xml::XmlVersion;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde_json::{Map, Value, json};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::errors::{AppError, AppResult};
use crate::models::mindmap::{
    MindmapContent, MindmapImage, MindmapStructure, MindmapTheme, MindmapTopic,
};
use crate::services::mindmap_format::{
    ImageLoader, ImportedMindmap, content_from_value, html_to_text, json_f64, json_string,
    json_strings, marker_from_xmind, new_topic, stable_sheet_id, stable_topic_id,
    structure_from_xmind, xmind_marker_id, xmind_structure_class, xml_attribute_suffix,
    xml_attribute_value,
};

const MAX_ZIP_ENTRIES: usize = 10_000;
const MAX_TOTAL_UNCOMPRESSED: u64 = 50 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED: u64 = 20 * 1024 * 1024;

/// 解析 `.xmind`，多画布返回多个导图。
pub fn parse(path: &Path) -> AppResult<Vec<ImportedMindmap>> {
    let file = File::open(path)?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| AppError::validation("XMind 文件无法读取"))?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(AppError::validation("XMind 文件内部条目过多"));
    }

    let mut content_json = None;
    let mut content_xml = None;
    let mut resources = BTreeMap::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| AppError::validation("XMind ZIP 条目损坏"))?;
        let name = entry
            .name()
            .map_err(|_| AppError::validation("XMind ZIP 文件名损坏"))?
            .to_string();
        if entry.is_dir() {
            continue;
        }
        if name.contains("..") || name.starts_with('/') || name.contains('\\') {
            return Err(AppError::validation("XMind 文件包含不安全路径"));
        }
        let size = entry.size();
        if size > MAX_ENTRY_UNCOMPRESSED || total.saturating_add(size) > MAX_TOTAL_UNCOMPRESSED {
            return Err(AppError::validation("XMind 文件解压后过大"));
        }
        total += size;
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|_| AppError::validation("XMind 文件读取失败"))?;
        if bytes.len() as u64 > MAX_ENTRY_UNCOMPRESSED {
            return Err(AppError::validation("XMind 文件解压后过大"));
        }
        match name.as_str() {
            "content.json" => content_json = Some(bytes),
            "content.xml" => content_xml = Some(bytes),
            _ if name.starts_with("resources/") => {
                resources.insert(name, bytes);
            }
            _ => {}
        }
    }

    if let Some(bytes) = content_json {
        return parse_modern(&bytes, resources);
    }
    if let Some(bytes) = content_xml {
        return parse_legacy(&bytes, resources);
    }
    Err(AppError::validation(
        "XMind 文件缺少 content.json 或 content.xml",
    ))
}

/// 导出 XMind 2020+。
pub fn export(
    content: &MindmapContent,
    title: &str,
    image_loader: ImageLoader<'_>,
) -> AppResult<Vec<u8>> {
    let mut resources = Vec::new();
    let sheet = topic_to_json(
        &content.sheet.root,
        content.sheet.structure,
        &mut resources,
        image_loader,
    )?;
    let content_value = json!([{
        "id": content.sheet.id,
        "class": "sheet",
        "title": title,
        "extensions": [],
        "topicPositioning": "fixed",
        "topicOverlapping": "overlap",
        "coreVersion": "2.100.0",
        "rootTopic": sheet,
    }]);
    let metadata = json!({
        "modifier": "Starris",
        "dataStructureVersion": "2",
        "creator": { "name": "Starris", "version": "0.1.0" },
        "layoutEngineVersion": "3",
        "activeSheetId": content.sheet.id,
    });
    let mut file_entries = Map::new();
    file_entries.insert("content.json".to_string(), json!({}));
    file_entries.insert("metadata.json".to_string(), json!({}));
    file_entries.insert("Thumbnails/thumbnail.png".to_string(), json!({}));
    for (name, _) in &resources {
        file_entries.insert(name.clone(), json!({}));
    }
    let manifest = json!({ "file-entries": file_entries });

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file("content.json", options)
            .map_err(|_| AppError::Internal)?;
        writer
            .write_all(
                serde_json::to_vec(&content_value)
                    .map_err(|_| AppError::Internal)?
                    .as_slice(),
            )
            .map_err(|_| AppError::Internal)?;
        writer
            .start_file("metadata.json", options)
            .map_err(|_| AppError::Internal)?;
        writer
            .write_all(
                serde_json::to_vec(&metadata)
                    .map_err(|_| AppError::Internal)?
                    .as_slice(),
            )
            .map_err(|_| AppError::Internal)?;
        writer
            .start_file("manifest.json", options)
            .map_err(|_| AppError::Internal)?;
        writer
            .write_all(
                serde_json::to_vec(&manifest)
                    .map_err(|_| AppError::Internal)?
                    .as_slice(),
            )
            .map_err(|_| AppError::Internal)?;
        for (name, bytes) in resources {
            writer
                .start_file(&name, options)
                .map_err(|_| AppError::Internal)?;
            writer.write_all(&bytes).map_err(|_| AppError::Internal)?;
        }
        writer.finish().map_err(|_| AppError::Internal)?;
    }
    Ok(cursor.into_inner())
}

fn parse_modern(
    bytes: &[u8],
    resources: BTreeMap<String, Vec<u8>>,
) -> AppResult<Vec<ImportedMindmap>> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| AppError::validation("XMind content.json 无法解析"))?;
    let sheets = value
        .as_array()
        .ok_or_else(|| AppError::validation("XMind content.json 根结构无效"))?;
    let mut result = Vec::new();
    for sheet in sheets {
        let Some(object) = sheet.as_object() else {
            continue;
        };
        let Some(root_value) = object.get("rootTopic") else {
            continue;
        };
        let mut warnings = Vec::new();
        let mut image_resources = Vec::new();
        let root = topic_from_json(root_value, &resources, &mut warnings, &mut image_resources)?;
        let structure = structure_from_xmind(json_string(object, "structureClass").as_deref());
        let content = MindmapContent {
            schema_version: 2,
            sheet: crate::models::mindmap::MindmapSheet {
                id: stable_sheet_id(json_string(object, "id").as_deref()),
                structure,
                theme: MindmapTheme::Vivid,
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
        };
        content_from_value(serde_json::to_value(&content).map_err(|_| AppError::Internal)?)?;
        if json_string(object, "title").is_some_and(|title| !title.trim().is_empty()) {
            warnings
                .push("XMind 画布标题已作为 Starris 节点标题；中心主题文本独立保留。".to_string());
        }
        warnings.sort();
        warnings.dedup();
        result.push(ImportedMindmap {
            title: json_string(object, "title")
                .filter(|title| !title.trim().is_empty())
                .unwrap_or_else(|| content.sheet.root.text.clone()),
            content,
            warnings,
            image_resources,
        });
    }
    if result.is_empty() {
        return Err(AppError::validation("XMind 文件没有可导入的画布"));
    }
    Ok(result)
}

fn topic_from_json(
    value: &Value,
    resources: &BTreeMap<String, Vec<u8>>,
    warnings: &mut Vec<String>,
    image_resources: &mut Vec<(String, Vec<u8>, String)>,
) -> AppResult<MindmapTopic> {
    let object = value
        .as_object()
        .ok_or_else(|| AppError::validation("XMind 主题结构无效"))?;
    let mut topic = new_topic(json_string(object, "title").unwrap_or_default());
    topic.id = stable_topic_id(json_string(object, "id").as_deref());
    topic.collapsed = json_string(object, "branch").is_some_and(|value| value == "folded");
    if let Some(notes) = object.get("notes").and_then(Value::as_object) {
        let html = notes
            .get("realHTML")
            .and_then(Value::as_object)
            .and_then(|item| json_string(item, "content"));
        let plain = notes
            .get("plain")
            .and_then(Value::as_object)
            .and_then(|item| json_string(item, "content"));
        topic.note = html_to_text(html.or(plain).unwrap_or_default().as_str());
    }
    topic.labels = json_strings(object, "labels");
    if let Some(href) = json_string(object, "href") {
        topic.link = normalize_link(&href);
    }
    if let Some(markers) = object.get("markers").and_then(Value::as_array) {
        for marker in markers {
            let Some(marker_id) = marker
                .as_object()
                .and_then(|item| json_string(item, "markerId"))
            else {
                continue;
            };
            match marker_from_xmind(&marker_id) {
                Some(mapped) => topic.markers.push(mapped.to_string()),
                None => warnings.push(format!("忽略 XMind 标记 {marker_id}。")),
            }
        }
    }
    if let Some(image) = object.get("image").and_then(Value::as_object)
        && let Some(src) = json_string(image, "src")
    {
        let resource_name = normalize_resource_name(&src);
        if let Some(bytes) = resources.get(&resource_name) {
            let extension = resource_name
                .rsplit('.')
                .next()
                .unwrap_or("png")
                .to_ascii_lowercase();
            let mime = mime_from_extension(&extension).to_string();
            let width = json_f64(image, "width").unwrap_or(160.0).clamp(1.0, 4096.0);
            let height = json_f64(image, "height").unwrap_or(90.0).clamp(1.0, 4096.0);
            topic.image = Some(MindmapImage {
                object_id: src.clone(),
                width,
                height,
            });
            image_resources.push((src, bytes.clone(), mime));
        } else {
            warnings.push(format!("XMind 图片资源 {resource_name} 缺失。"));
        }
    }
    if let Some(children) = object.get("children").and_then(Value::as_object) {
        if let Some(attached) = children.get("attached").and_then(Value::as_array) {
            for child in attached {
                topic.children.push(topic_from_json(
                    child,
                    resources,
                    warnings,
                    image_resources,
                )?);
            }
        }
        if let Some(detached) = children.get("detached").and_then(Value::as_array)
            && !detached.is_empty()
        {
            warnings.push("XMind 浮主题已导入为中心主题的子主题。".to_string());
            for child in detached {
                topic.children.push(topic_from_json(
                    child,
                    resources,
                    warnings,
                    image_resources,
                )?);
            }
        }
    }
    Ok(topic)
}

fn parse_legacy(
    bytes: &[u8],
    resources: BTreeMap<String, Vec<u8>>,
) -> AppResult<Vec<ImportedMindmap>> {
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| AppError::validation("XMind 8 内容必须是 UTF-8"))?;
    let mut reader = Reader::from_str(&text);
    reader.config_mut().trim_text(true);
    let mut sheets: Vec<(String, MindmapTopic)> = Vec::new();
    let mut current_sheet_title = String::new();
    let mut topic_stack: Vec<(MindmapTopic, Vec<MindmapTopic>)> = Vec::new();
    let mut in_title = false;
    let mut in_plain = false;
    let mut in_label = false;
    let mut text_buffer = String::new();
    let mut warnings = vec!["XMind 8 样式与扩展字段不导入。".to_string()];
    let mut image_resources: Vec<(String, Vec<u8>, String)> = Vec::new();

    loop {
        match reader
            .read_event()
            .map_err(|error| AppError::validation(format!("XMind 8 XML 解析失败：{error}")))?
        {
            Event::Start(element) => match element.name().as_ref() {
                "sheet" => {
                    current_sheet_title = String::new();
                    topic_stack.clear();
                }
                "topic" => {
                    let mut topic = new_topic(String::new());
                    topic.id = stable_topic_id(xml_attribute_value(&element, "id").as_deref());
                    topic.collapsed = xml_attribute_value(&element, "branch")
                        .is_some_and(|value| value == "folded");
                    topic_stack.push((topic, Vec::new()));
                }
                "title" => {
                    in_title = true;
                    text_buffer.clear();
                }
                "plain" => {
                    in_plain = true;
                    text_buffer.clear();
                }
                "label" => {
                    in_label = true;
                    text_buffer.clear();
                }
                "marker-ref" => {
                    if let Some(marker_id) = xml_attribute_value(&element, "marker-id") {
                        match marker_from_xmind(&marker_id) {
                            Some(mapped) => {
                                if let Some((topic, _)) = topic_stack.last_mut() {
                                    topic.markers.push(mapped.to_string());
                                }
                            }
                            None => warnings.push(format!("忽略 XMind 标记 {marker_id}。")),
                        }
                    }
                }
                "image" => {
                    if let Some(src) = xml_attribute_suffix(&element, "href") {
                        let resource_name = normalize_resource_name(&src);
                        if let Some(data) = resources.get(&resource_name) {
                            let extension = resource_name
                                .rsplit('.')
                                .next()
                                .unwrap_or("png")
                                .to_ascii_lowercase();
                            if let Some((topic, _)) = topic_stack.last_mut() {
                                topic.image = Some(MindmapImage {
                                    object_id: src.clone(),
                                    width: 160.0,
                                    height: 90.0,
                                });
                                image_resources.push((
                                    src,
                                    data.clone(),
                                    mime_from_extension(&extension).to_string(),
                                ));
                            }
                        }
                    }
                }
                "url" => {
                    if let Some(href) = xml_attribute_suffix(&element, "href")
                        && let Some((topic, _)) = topic_stack.last_mut()
                    {
                        topic.link = normalize_link(&href);
                    }
                }
                _ => {}
            },
            Event::Text(event) => {
                if in_title || in_plain || in_label {
                    text_buffer.push_str(&event.xml_content(XmlVersion::Implicit1_0));
                }
            }
            Event::End(element) => match element.name().as_ref() {
                "title" => {
                    if let Some((topic, _)) = topic_stack.last_mut() {
                        topic.text = text_buffer.trim().to_string();
                    } else {
                        current_sheet_title = text_buffer.trim().to_string();
                    }
                    in_title = false;
                }
                "plain" => {
                    if let Some((topic, _)) = topic_stack.last_mut() {
                        topic.note = text_buffer.trim().to_string();
                    }
                    in_plain = false;
                }
                "label" => {
                    if let Some((topic, _)) = topic_stack.last_mut() {
                        topic.labels.push(text_buffer.trim().to_string());
                    }
                    in_label = false;
                }
                "topic" => {
                    if let Some((mut topic, children)) = topic_stack.pop() {
                        topic.children = children;
                        if let Some((_, siblings)) = topic_stack.last_mut() {
                            siblings.push(topic);
                        } else {
                            sheets.push((current_sheet_title.clone(), topic));
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    if sheets.is_empty() {
        return Err(AppError::validation("XMind 8 文件没有可导入主题"));
    }
    warnings.sort();
    warnings.dedup();
    Ok(sheets
        .into_iter()
        .map(|(title, root)| {
            let content = MindmapContent {
                schema_version: 2,
                sheet: crate::models::mindmap::MindmapSheet {
                    id: stable_sheet_id(None),
                    structure: MindmapStructure::Balanced,
                    theme: MindmapTheme::Vivid,
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
            };
            ImportedMindmap {
                title: if title.trim().is_empty() {
                    content.sheet.root.text.clone()
                } else {
                    title
                },
                content,
                warnings: warnings.clone(),
                image_resources: image_resources.clone(),
            }
        })
        .collect())
}

fn topic_to_json(
    topic: &MindmapTopic,
    structure: MindmapStructure,
    resources: &mut Vec<(String, Vec<u8>)>,
    image_loader: ImageLoader<'_>,
) -> AppResult<Value> {
    let mut object = Map::new();
    object.insert("id".to_string(), json!(topic.id));
    object.insert("class".to_string(), json!("topic"));
    object.insert("title".to_string(), json!(topic.text));
    object.insert(
        "structureClass".to_string(),
        json!(xmind_structure_class(structure)),
    );
    if topic.collapsed {
        object.insert("branch".to_string(), json!("folded"));
    }
    if !topic.note.is_empty() {
        object.insert(
            "notes".to_string(),
            json!({
                "plain": { "content": topic.note },
                "realHTML": { "content": format!("<div>{}</div>", xml_escape_text(&topic.note)) }
            }),
        );
    }
    if !topic.labels.is_empty() {
        object.insert("labels".to_string(), json!(topic.labels));
    }
    if !topic.link.is_empty() {
        object.insert("href".to_string(), json!(topic.link));
    }
    if !topic.markers.is_empty() {
        let markers: Vec<Value> = topic
            .markers
            .iter()
            .filter_map(|marker| xmind_marker_id(marker))
            .map(|marker| json!({ "markerId": marker }))
            .collect();
        if !markers.is_empty() {
            object.insert("markers".to_string(), json!(markers));
        }
    }
    if let Some(image) = &topic.image {
        let (bytes, extension) = image_loader(&image.object_id)?;
        let resource_name = format!(
            "resources/{}.{}",
            image.object_id.replace('/', "_"),
            extension
        );
        resources.push((resource_name.clone(), bytes));
        object.insert(
            "image".to_string(),
            json!({
                "src": format!("xap:{}", resource_name),
                "width": image.width,
                "height": image.height,
            }),
        );
    }
    if !topic.children.is_empty() {
        let attached: Vec<Value> = topic
            .children
            .iter()
            .map(|child| topic_to_json(child, structure, resources, image_loader))
            .collect::<AppResult<_>>()?;
        object.insert(
            "children".to_string(),
            json!({ "attached": attached, "detached": [] }),
        );
    }
    Ok(Value::Object(object))
}

fn normalize_resource_name(src: &str) -> String {
    src.trim()
        .trim_start_matches("xap:")
        .trim_start_matches("xmind:")
        .trim_start_matches('/')
        .to_string()
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

fn mime_from_extension(extension: &str) -> &'static str {
    match extension {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn xml_escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
