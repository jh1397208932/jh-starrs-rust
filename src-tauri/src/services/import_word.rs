//! Word（DOCX/DOC/DOCM/DOTX/DOTM）→ Tiptap 块 JSON。
//!
//! 通过 office_oxide 的格式无关 IR 读取段落、标题、列表、表格、图片、脚注、
//! 批注、文本框与页眉页脚；图片写入附件对象库，转成 attachmentImage。
//! 无法映射的块以 JSON 代码块保留；原文件由导入服务另外附加，保证不丢数据。

use std::path::Path;

use office_oxide::ir::{
    DocumentIR, Element, Image, ImageFormat, InlineContent, List, ListItem, ParagraphAlignment,
    Table, TableCell, TextSpan, VerticalAlign,
};
use serde_json::{Value, json};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::services::attachment_service::{self, AttachmentContext};

/// Word 解析结果。
pub struct ParsedWord {
    pub blocks: Vec<Value>,
    pub warnings: Vec<String>,
    pub attachment_count: usize,
}

struct WordCtx<'a> {
    context: &'a AttachmentContext,
    warnings: Vec<String>,
    attachment_count: usize,
    notes: Vec<(String, Vec<Value>)>,
    asset_prefix: String,
}

/// 解析 Word 文件；支持 `.docx/.docm/.dotx/.dotm/.doc`。
pub fn parse_word(
    context: &AttachmentContext,
    source: &Path,
    asset_prefix: &str,
) -> AppResult<ParsedWord> {
    let document = office_oxide::Document::open(source).map_err(|error| {
        logging::error("import.word", &format!("Word 解析失败: {error}"));
        AppError::validation("Word 文件无法读取，请确认未加密")
    })?;
    let ir = document.to_ir();
    let mut ctx = WordCtx {
        context,
        warnings: Vec::new(),
        attachment_count: 0,
        notes: Vec::new(),
        asset_prefix: asset_prefix.to_string(),
    };
    let mut blocks = map_document(&ir, &mut ctx);
    if !ctx.notes.is_empty() {
        let notes = std::mem::take(&mut ctx.notes);
        for (title, content) in notes {
            blocks
                .push(json!({"type": "heading", "attrs": {"level": 2}, "content": [text(&title)]}));
            blocks.extend(content);
        }
    }
    Ok(ParsedWord {
        blocks,
        warnings: ctx.warnings,
        attachment_count: ctx.attachment_count,
    })
}

fn map_document(ir: &DocumentIR, ctx: &mut WordCtx<'_>) -> Vec<Value> {
    let mut blocks = Vec::new();
    for section in &ir.sections {
        if let Some(title) = &section.title {
            blocks
                .push(json!({"type": "heading", "attrs": {"level": 1}, "content": [text(title)]}));
        }
        blocks.extend(map_elements(&section.elements, ctx));
        append_part(
            &mut blocks,
            section.header.as_ref().map(|part| &part.content),
            "页眉",
            ctx,
        );
        append_part(
            &mut blocks,
            section.footer.as_ref().map(|part| &part.content),
            "页脚",
            ctx,
        );
        append_part(
            &mut blocks,
            section.first_page_header.as_ref().map(|part| &part.content),
            "首页页眉",
            ctx,
        );
        append_part(
            &mut blocks,
            section.first_page_footer.as_ref().map(|part| &part.content),
            "首页页脚",
            ctx,
        );
        append_part(
            &mut blocks,
            section.even_page_header.as_ref().map(|part| &part.content),
            "偶数页页眉",
            ctx,
        );
        append_part(
            &mut blocks,
            section.even_page_footer.as_ref().map(|part| &part.content),
            "偶数页页脚",
            ctx,
        );
        if let Some(notes) = &section.speaker_notes {
            let content = map_elements(notes, ctx);
            ctx.notes.push(("演讲者备注".to_string(), content));
        }
        if section.hidden {
            ctx.warnings
                .push("文档包含隐藏分节，内容已保留".to_string());
        }
    }
    blocks
}

fn append_part(
    blocks: &mut Vec<Value>,
    content: Option<&Vec<Element>>,
    title: &str,
    ctx: &mut WordCtx<'_>,
) {
    let Some(content) = content else {
        return;
    };
    if content.is_empty() {
        return;
    }
    blocks.push(json!({"type": "heading", "attrs": {"level": 2}, "content": [text(title)]}));
    blocks.extend(map_elements(content, ctx));
}

fn map_elements(elements: &[Element], ctx: &mut WordCtx<'_>) -> Vec<Value> {
    let mut blocks = Vec::new();
    for element in elements {
        map_element(element, &mut blocks, ctx);
    }
    blocks
}

fn map_element(element: &Element, blocks: &mut Vec<Value>, ctx: &mut WordCtx<'_>) {
    match element {
        Element::Heading(heading) => {
            let level = heading.level.clamp(1, 6);
            let mut attrs = serde_json::Map::new();
            attrs.insert("level".to_string(), Value::Number(level.into()));
            add_alignment(&mut attrs, heading.alignment.as_ref());
            blocks.push(json!({
                "type": "heading",
                "attrs": Value::Object(attrs),
                "content": map_inline(&heading.content, ctx),
            }));
        }
        Element::Paragraph(paragraph) => {
            let mut attrs = serde_json::Map::new();
            add_alignment(&mut attrs, paragraph.alignment.as_ref());
            blocks.push(json!({
                "type": "paragraph",
                "attrs": Value::Object(attrs),
                "content": map_inline(&paragraph.content, ctx),
            }));
        }
        Element::Table(table) => blocks.push(map_table(table, ctx)),
        Element::List(list) => blocks.push(map_list(list, ctx)),
        Element::Image(image) => blocks.push(map_image(image, ctx)),
        Element::ThematicBreak => blocks.push(json!({"type": "horizontalRule"})),
        Element::PageBreak | Element::ColumnBreak => {
            ctx.warnings
                .push("分页/分栏符已转为分隔线，原始文件已作为附件保留".to_string());
            blocks.push(json!({"type": "horizontalRule"}));
        }
        Element::TextBox(text_box) => {
            blocks.push(json!({
                "type": "blockquote",
                "content": map_elements(&text_box.content, ctx),
            }));
            ctx.warnings
                .push("文本框已转为引用块，原始文件已作为附件保留".to_string());
        }
        Element::Footnote(note) => {
            let content = map_elements(&note.content, ctx);
            ctx.notes.push((
                format!(
                    "脚注 {}",
                    note.marker.clone().unwrap_or_else(|| note.id.to_string())
                ),
                content,
            ));
        }
        Element::Endnote(note) => {
            let label = note
                .author
                .as_ref()
                .map(|author| format!("批注（{author}）"))
                .unwrap_or_else(|| "尾注".to_string());
            let content = map_elements(&note.content, ctx);
            ctx.notes.push((label, content));
        }
        Element::CodeBlock(code) => {
            blocks.push(json!({
                "type": "codeBlock",
                "attrs": {"language": code.language.clone().unwrap_or_default()},
                "content": [{"type": "text", "text": code.content}],
            }));
        }
        Element::Shape(shape) => {
            ctx.warnings
                .push("图形/线条未能原生导入，原始文件已作为附件保留".to_string());
            blocks.push(json!({
                "type": "paragraph",
                "content": [{"type": "text", "text": format!(
                    "[图形] {}×{} EMU", shape.width_emu, shape.height_emu
                )}],
            }));
        }
        _ => {
            let raw = serde_json::to_string(element).unwrap_or_default();
            ctx.warnings
                .push("Word 中存在未识别的块，已以 JSON 代码块保留".to_string());
            blocks.push(json!({
                "type": "codeBlock",
                "attrs": {"language": "json"},
                "content": [{"type": "text", "text": raw}],
            }));
        }
    }
}

fn map_inline(content: &[InlineContent], ctx: &mut WordCtx<'_>) -> Vec<Value> {
    let mut nodes = Vec::new();
    for item in content {
        match item {
            InlineContent::Text(span) => {
                if let Some(node) = text_span(span, ctx) {
                    nodes.push(node);
                }
            }
            InlineContent::LineBreak => nodes.push(json!({"type": "hardBreak"})),
            InlineContent::FootnoteRef(reference) => {
                nodes.push(json!({
                    "type": "text",
                    "text": format!("[{}]", reference.marker.clone().unwrap_or_else(|| reference.note_id.to_string())),
                    "marks": [{"type": "superscript"}],
                }));
            }
            InlineContent::EndnoteRef(reference) => {
                nodes.push(json!({
                    "type": "text",
                    "text": format!("[{}]", reference.marker.clone().unwrap_or_else(|| reference.note_id.to_string())),
                    "marks": [{"type": "superscript"}],
                }));
            }
            InlineContent::CommentStart(_) | InlineContent::CommentRef(_) => {}
            _ => {}
        }
    }
    nodes
}

fn text_span(span: &TextSpan, ctx: &mut WordCtx<'_>) -> Option<Value> {
    if span.text.is_empty() {
        return None;
    }
    let mut marks = Vec::new();
    if span.bold {
        marks.push(json!({"type": "bold"}));
    }
    if span.italic {
        marks.push(json!({"type": "italic"}));
    }
    if span.strikethrough {
        marks.push(json!({"type": "strike"}));
    }
    if span.underline.is_some() {
        marks.push(json!({"type": "underline"}));
    }
    if let Some(color) = span.color {
        marks.push(json!({"type": "textStyle", "attrs": {"color": rgb(color)}}));
    }
    if let Some(color) = span.highlight {
        marks.push(json!({"type": "highlight", "attrs": {"color": rgb(color)}}));
    }
    match span.vertical_align {
        Some(VerticalAlign::Superscript) => marks.push(json!({"type": "superscript"})),
        Some(VerticalAlign::Subscript) => marks.push(json!({"type": "subscript"})),
        _ => {}
    }
    if let Some(href) = &span.hyperlink
        && is_safe_href(href)
    {
        marks.push(json!({
            "type": "link",
            "attrs": {"href": href, "target": "_blank", "rel": "noopener noreferrer nofollow"},
        }));
    }
    if span.all_caps || span.small_caps {
        ctx.warnings
            .push("Word 的大写/小型大写格式已保留原文字，未强制改写".to_string());
    }
    let mut node = json!({"type": "text", "text": span.text});
    if !marks.is_empty() {
        node["marks"] = Value::Array(marks);
    }
    Some(node)
}

fn map_list(list: &List, ctx: &mut WordCtx<'_>) -> Value {
    let list_type = if list.ordered {
        "orderedList"
    } else {
        "bulletList"
    };
    let mut attrs = serde_json::Map::new();
    if list.ordered {
        attrs.insert(
            "start".to_string(),
            Value::Number(list.start_number.unwrap_or(1).into()),
        );
    }
    let items = list
        .items
        .iter()
        .map(|item| map_list_item(item, ctx))
        .collect::<Vec<_>>();
    json!({
        "type": list_type,
        "attrs": Value::Object(attrs),
        "content": items,
    })
}

fn map_list_item(item: &ListItem, ctx: &mut WordCtx<'_>) -> Value {
    let mut content = map_elements(&item.content, ctx);
    if let Some(nested) = &item.nested {
        content.push(map_list(nested, ctx));
    }
    if content.is_empty() {
        content.push(json!({"type": "paragraph"}));
    }
    json!({"type": "listItem", "content": content})
}

fn map_table(table: &Table, ctx: &mut WordCtx<'_>) -> Value {
    let rows = table
        .rows
        .iter()
        .map(|row| {
            let cells = row
                .cells
                .iter()
                .map(|cell| map_table_cell(cell, row.is_header, ctx))
                .collect::<Vec<_>>();
            json!({"type": "tableRow", "content": cells})
        })
        .collect::<Vec<_>>();
    json!({"type": "table", "content": rows})
}

fn map_table_cell(cell: &TableCell, header: bool, ctx: &mut WordCtx<'_>) -> Value {
    let mut content = map_elements(&cell.content, ctx);
    if content.is_empty() {
        content.push(json!({"type": "paragraph"}));
    }
    let mut attrs = serde_json::Map::new();
    if cell.col_span > 1 {
        attrs.insert("colspan".to_string(), Value::Number(cell.col_span.into()));
    }
    if cell.row_span > 1 {
        attrs.insert("rowspan".to_string(), Value::Number(cell.row_span.into()));
    }
    let cell_type = if header { "tableHeader" } else { "tableCell" };
    json!({
        "type": cell_type,
        "attrs": Value::Object(attrs),
        "content": content,
    })
}

fn map_image(image: &Image, ctx: &mut WordCtx<'_>) -> Value {
    let name = format!(
        "{}-image-{}.{}",
        ctx.asset_prefix,
        ctx.attachment_count + 1,
        image
            .format
            .as_ref()
            .map(ImageFormat::extension)
            .unwrap_or("bin")
    );
    let mime = image
        .format
        .as_ref()
        .map(|format| format.content_type().to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string());
    if let Some(data) = &image.data {
        match attachment_service::upload_bytes(
            ctx.context,
            name.clone(),
            "attach".to_string(),
            Some(mime.clone()),
            data.clone(),
        ) {
            Ok(attachment) => {
                ctx.attachment_count += 1;
                let width = image
                    .display_width_emu
                    .map(|emu| (emu / 9525).min(u32::MAX as u64) as u32)
                    .unwrap_or(0);
                return json!({
                    "type": "attachmentImage",
                    "attrs": {
                        "attachmentId": attachment.id,
                        "name": attachment.name,
                        "size": attachment.size,
                        "mime": attachment.mime,
                        "alt": image.alt_text.clone().unwrap_or_default(),
                        "width": width,
                        "align": "left",
                    },
                });
            }
            Err(error) => ctx.warnings.push(format!("Word 图片导入失败：{error}")),
        }
    }
    if let Some(source) = &image.source_url {
        return json!({
            "type": "image",
            "attrs": {"src": source, "alt": image.alt_text.clone().unwrap_or_default()},
        });
    }
    ctx.warnings
        .push("Word 中存在无法提取的图片，原始文件已保留".to_string());
    json!({
        "type": "paragraph",
        "content": [{"type": "text", "text": "[图片无法提取]"}],
    })
}

fn add_alignment(
    attrs: &mut serde_json::Map<String, Value>,
    alignment: Option<&ParagraphAlignment>,
) {
    let value = match alignment {
        Some(ParagraphAlignment::Center) => "center",
        Some(ParagraphAlignment::Right) => "right",
        Some(ParagraphAlignment::Justify) | Some(ParagraphAlignment::Distribute) => "justify",
        _ => return,
    };
    attrs.insert("textAlign".to_string(), Value::String(value.to_string()));
}

fn rgb(color: [u8; 3]) -> String {
    format!("#{:02X}{:02X}{:02X}", color[0], color[1], color[2])
}

fn is_safe_href(href: &str) -> bool {
    let lower = href.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with('#')
        || (!lower.contains(':'))
}

fn text(value: &str) -> Value {
    json!({"type": "text", "text": value})
}
