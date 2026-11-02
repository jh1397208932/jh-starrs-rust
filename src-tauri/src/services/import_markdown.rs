//! Markdown → Tiptap 块 JSON。
//!
//! 使用 pulldown-cmark 的事件流覆盖 CommonMark + GFM：标题、段落、强调/加粗/
//! 删除线/上下标/行内代码、链接、图片、列表（含任务列表）、表格、引用、代码块、
//! 分隔线、脚注、定义列表、数学、YAML front matter 与原始 HTML。
//! 无法表达的原始内容一律以代码块/文本保留，绝不静默丢弃。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde_json::{Value, json};

use crate::errors::AppResult;
use crate::models::attachment::UploadAttachmentInput;
use crate::services::attachment_service::{self, AttachmentContext};

/// Markdown 解析结果。
pub struct ParsedMarkdown {
    pub blocks: Vec<Value>,
    pub warnings: Vec<String>,
    pub attachment_count: usize,
}

struct ListCtx {
    ordered: bool,
    start: Option<u64>,
    items: Vec<ItemData>,
    task: bool,
}

struct ItemData {
    blocks: Vec<Value>,
    checked: Option<bool>,
}

struct TableCtx {
    rows: Vec<Value>,
    header: bool,
    current_row: Option<Vec<Value>>,
}

struct ImageCapture {
    dest: String,
    title: String,
    alt: String,
}

struct MdBuilder<'a> {
    root: Vec<Value>,
    block_stack: Vec<Vec<Value>>,
    lists: Vec<ListCtx>,
    items: Vec<ItemData>,
    tables: Vec<TableCtx>,
    cells: Vec<Vec<Value>>,
    inline: Option<Vec<Value>>,
    heading: Option<u8>,
    marks: Vec<Value>,
    code: Option<(Option<String>, String)>,
    raw: Option<(String, String)>,
    image: Option<ImageCapture>,
    footnote_label: Option<String>,
    footnotes: BTreeMap<String, Vec<Value>>,
    warnings: Vec<String>,
    attachment_count: usize,
    source_dir: PathBuf,
    asset_prefix: String,
    context: &'a AttachmentContext,
    /// 是否把图片/本地链接登记为附件；预览用 false。
    persist_assets: bool,
}

/// 解析 Markdown 文件；本地图片/链接会登记为附件，源文件由调用方另行附加。
pub fn parse_markdown(
    context: &AttachmentContext,
    source: &Path,
    source_text: &str,
    asset_prefix: &str,
) -> AppResult<ParsedMarkdown> {
    parse_markdown_with(context, source, source_text, asset_prefix, true)
}

/// 预览用：与导入同一套解析，但不把图片/链接写进附件库。
pub fn parse_markdown_preview(
    context: &AttachmentContext,
    source: &Path,
    source_text: &str,
) -> AppResult<Vec<Value>> {
    Ok(parse_markdown_with(context, source, source_text, "preview", false)?.blocks)
}

fn parse_markdown_with(
    context: &AttachmentContext,
    source: &Path,
    source_text: &str,
    asset_prefix: &str,
    persist_assets: bool,
) -> AppResult<ParsedMarkdown> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);
    options.insert(Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS);
    options.insert(Options::ENABLE_MATH);
    options.insert(Options::ENABLE_GFM);
    options.insert(Options::ENABLE_DEFINITION_LIST);
    options.insert(Options::ENABLE_SUPERSCRIPT);
    options.insert(Options::ENABLE_SUBSCRIPT);
    options.insert(Options::ENABLE_WIKILINKS);

    let mut builder = MdBuilder {
        root: Vec::new(),
        block_stack: Vec::new(),
        lists: Vec::new(),
        items: Vec::new(),
        tables: Vec::new(),
        cells: Vec::new(),
        inline: None,
        heading: None,
        marks: Vec::new(),
        code: None,
        raw: None,
        image: None,
        footnote_label: None,
        footnotes: BTreeMap::new(),
        warnings: Vec::new(),
        attachment_count: 0,
        source_dir: source.parent().unwrap_or(Path::new(".")).to_path_buf(),
        asset_prefix: asset_prefix.to_string(),
        context,
        persist_assets,
    };

    for event in Parser::new_ext(source_text, options) {
        builder.handle(event);
    }
    builder.flush_inline();

    if !builder.footnotes.is_empty() {
        builder.push_block(
            json!({"type": "heading", "attrs": {"level": 2}, "content": [text("脚注")]}),
        );
        let footnotes = std::mem::take(&mut builder.footnotes);
        for (label, blocks) in footnotes {
            builder.push_block(json!({
                "type": "paragraph",
                "content": [
                    {"type": "text", "text": format!("[{label}] "), "marks": [{"type": "bold"}]},
                ],
            }));
            builder.root.extend(blocks);
        }
    }

    Ok(ParsedMarkdown {
        blocks: builder.root,
        warnings: builder.warnings,
        attachment_count: builder.attachment_count,
    })
}

impl MdBuilder<'_> {
    fn handle(&mut self, event: Event<'_>) {
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(value) => self.text(&value),
            Event::Code(value) => {
                let mut marks = self.marks.clone();
                marks.push(json!({"type": "code"}));
                self.push_text_node(&value, marks);
            }
            Event::InlineMath(value) => {
                let mut marks = self.marks.clone();
                marks.push(json!({"type": "code"}));
                self.push_text_node(&format!("${value}$"), marks);
            }
            Event::DisplayMath(value) => {
                self.flush_inline();
                self.push_block(json!({
                    "type": "codeBlock",
                    "attrs": {"language": "math"},
                    "content": [{"type": "text", "text": value.to_string()}],
                }));
            }
            Event::Html(value) | Event::InlineHtml(value) => self.html(&value),
            Event::FootnoteReference(label) => {
                let mut marks = self.marks.clone();
                marks.push(json!({"type": "superscript"}));
                self.push_text_node(&format!("[{label}]"), marks);
            }
            Event::SoftBreak => self.text(" "),
            Event::HardBreak => {
                self.ensure_inline();
                if let Some(inline) = &mut self.inline {
                    inline.push(json!({"type": "hardBreak"}));
                }
            }
            Event::Rule => {
                self.flush_inline();
                self.push_block(json!({"type": "horizontalRule"}));
            }
            Event::TaskListMarker(checked) => {
                if let Some(list) = self.lists.last_mut() {
                    list.task = true;
                }
                if let Some(item) = self.items.last_mut() {
                    item.checked = Some(checked);
                }
            }
        }
    }

    fn start(&mut self, tag: Tag<'_>) {
        match tag {
            Tag::Paragraph => {
                self.flush_inline();
                self.inline = Some(Vec::new());
                self.heading = None;
            }
            Tag::Heading { level, .. } => {
                self.flush_inline();
                self.inline = Some(Vec::new());
                self.heading = Some(heading_level(level));
            }
            Tag::BlockQuote(_) => {
                self.flush_inline();
                self.block_stack.push(Vec::new());
            }
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(language) if !language.trim().is_empty() => {
                        Some(language.trim().to_string())
                    }
                    _ => None,
                };
                self.code = Some((language, String::new()));
            }
            Tag::HtmlBlock => self.raw = Some(("html".to_string(), String::new())),
            Tag::MetadataBlock(_) => self.raw = Some(("yaml".to_string(), String::new())),
            Tag::List(start) => {
                // 紧凑列表项的文字不会包在 Paragraph 里；进入子列表前必须先落成段落，
                // 否则父项文字会被拼进子列表项。
                self.flush_inline();
                self.lists.push(ListCtx {
                    ordered: start.is_some(),
                    start,
                    items: Vec::new(),
                    task: false,
                });
            }
            Tag::Item => {
                self.flush_inline();
                self.items.push(ItemData {
                    blocks: Vec::new(),
                    checked: None,
                });
            }
            Tag::FootnoteDefinition(label) => {
                self.flush_inline();
                self.block_stack.push(Vec::new());
                self.footnote_label = Some(label.to_string());
            }
            Tag::Table(_alignments) => self.tables.push(TableCtx {
                rows: Vec::new(),
                header: false,
                current_row: None,
            }),
            Tag::TableHead => {
                if let Some(table) = self.tables.last_mut() {
                    table.header = true;
                }
            }
            Tag::TableRow => {
                if let Some(table) = self.tables.last_mut() {
                    table.current_row = Some(Vec::new());
                }
            }
            Tag::TableCell => {
                self.flush_inline();
                self.cells.push(Vec::new());
            }
            Tag::Emphasis => self.marks.push(json!({"type": "italic"})),
            Tag::Strong => self.marks.push(json!({"type": "bold"})),
            Tag::Strikethrough => self.marks.push(json!({"type": "strike"})),
            Tag::Superscript => self.marks.push(json!({"type": "superscript"})),
            Tag::Subscript => self.marks.push(json!({"type": "subscript"})),
            Tag::Link { dest_url, .. } => {
                let href = dest_url.to_string();
                if is_local_file(&href) {
                    self.register_linked_file(&href);
                }
                self.marks.push(json!({
                    "type": "link",
                    "attrs": {"href": href, "target": "_blank", "rel": "noopener noreferrer nofollow"},
                }));
            }
            Tag::Image {
                dest_url, title, ..
            } => {
                self.flush_inline();
                self.image = Some(ImageCapture {
                    dest: dest_url.to_string(),
                    title: title.to_string(),
                    alt: String::new(),
                });
            }
            Tag::DefinitionList => {
                self.flush_inline();
                self.block_stack.push(Vec::new());
            }
            Tag::DefinitionListTitle | Tag::DefinitionListDefinition => {
                self.flush_inline();
                self.inline = Some(Vec::new());
                self.heading = None;
            }
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph | TagEnd::DefinitionListTitle | TagEnd::DefinitionListDefinition => {
                self.flush_inline();
            }
            TagEnd::Heading(_) => {
                if let Some(content) = self.inline.take()
                    && let Some(level) = self.heading.take()
                {
                    self.push_block(
                        json!({"type": "heading", "attrs": {"level": level}, "content": content}),
                    );
                }
                self.heading = None;
            }
            TagEnd::BlockQuote(_) => {
                self.flush_inline();
                if let Some(blocks) = self.block_stack.pop() {
                    self.push_block(json!({"type": "blockquote", "content": blocks}));
                }
            }
            TagEnd::CodeBlock => {
                if let Some((language, code)) = self.code.take() {
                    let mut attrs = serde_json::Map::new();
                    if let Some(language) = language {
                        attrs.insert("language".to_string(), Value::String(language));
                    }
                    self.push_block(json!({
                        "type": "codeBlock",
                        "attrs": Value::Object(attrs),
                        "content": [{"type": "text", "text": code}],
                    }));
                }
            }
            TagEnd::HtmlBlock | TagEnd::MetadataBlock(_) => {
                if let Some((language, raw)) = self.raw.take() {
                    self.push_block(json!({
                        "type": "codeBlock",
                        "attrs": {"language": language},
                        "content": [{"type": "text", "text": raw.trim_end()}],
                    }));
                }
            }
            TagEnd::List(ordered) => {
                self.flush_inline();
                if let Some(list) = self.lists.pop() {
                    let list_type = if list.task {
                        "taskList"
                    } else if ordered {
                        "orderedList"
                    } else {
                        "bulletList"
                    };
                    let items = list
                        .items
                        .into_iter()
                        .map(|item| {
                            let item_type = if list.task { "taskItem" } else { "listItem" };
                            let mut node = json!({"type": item_type, "content": item.blocks});
                            if list.task {
                                node["attrs"] = json!({"checked": item.checked.unwrap_or(false)});
                            }
                            node
                        })
                        .collect::<Vec<_>>();
                    let mut attrs = serde_json::Map::new();
                    if list.ordered {
                        attrs.insert(
                            "start".to_string(),
                            Value::Number(list.start.unwrap_or(1).into()),
                        );
                    }
                    self.push_block(json!({
                        "type": list_type,
                        "attrs": Value::Object(attrs),
                        "content": items,
                    }));
                }
            }
            TagEnd::Item => {
                self.flush_inline();
                if let Some(item) = self.items.pop()
                    && let Some(list) = self.lists.last_mut()
                {
                    list.items.push(item);
                }
            }
            TagEnd::FootnoteDefinition => {
                self.flush_inline();
                if let Some(blocks) = self.block_stack.pop()
                    && let Some(label) = self.footnote_label.take()
                {
                    self.footnotes.insert(label, blocks);
                }
            }
            TagEnd::Table => {
                self.flush_inline();
                if let Some(mut table) = self.tables.pop() {
                    if let Some(row) = table.current_row.take()
                        && !row.is_empty()
                    {
                        table.rows.push(json!({"type": "tableRow", "content": row}));
                    }
                    self.push_block(json!({"type": "table", "content": table.rows}));
                }
            }
            TagEnd::TableHead => {
                if let Some(table) = self.tables.last_mut() {
                    table.header = false;
                }
            }
            TagEnd::TableRow => {
                if let Some(table) = self.tables.last_mut()
                    && let Some(row) = table.current_row.take()
                {
                    table.rows.push(json!({"type": "tableRow", "content": row}));
                }
            }
            TagEnd::TableCell => {
                self.flush_inline();
                if let Some(mut cell) = self.cells.pop() {
                    if cell.is_empty() {
                        cell.push(json!({"type": "paragraph"}));
                    }
                    let header = self.tables.last().is_some_and(|table| table.header);
                    let cell_type = if header { "tableHeader" } else { "tableCell" };
                    if let Some(table) = self.tables.last_mut()
                        && let Some(row) = &mut table.current_row
                    {
                        row.push(json!({"type": cell_type, "content": cell}));
                    }
                }
            }
            TagEnd::Emphasis
            | TagEnd::Strong
            | TagEnd::Strikethrough
            | TagEnd::Superscript
            | TagEnd::Subscript
            | TagEnd::Link => {
                self.marks.pop();
            }
            TagEnd::Image => {
                if let Some(image) = self.image.take() {
                    self.finish_image(image);
                }
            }
            TagEnd::DefinitionList => {
                self.flush_inline();
                if let Some(blocks) = self.block_stack.pop() {
                    for block in blocks {
                        self.push_block(block);
                    }
                }
            }
        }
    }

    fn text(&mut self, value: &str) {
        if let Some((_, code)) = &mut self.code {
            code.push_str(value);
            return;
        }
        if let Some((_, raw)) = &mut self.raw {
            raw.push_str(value);
            return;
        }
        if let Some(image) = &mut self.image {
            image.alt.push_str(value);
            return;
        }
        self.push_text_node(value, self.marks.clone());
    }

    fn html(&mut self, value: &str) {
        match value.trim().to_ascii_lowercase().as_str() {
            "<u>" => self.marks.push(json!({"type": "underline"})),
            "</u>" => {
                self.marks.pop();
            }
            "<strong>" | "<b>" => self.marks.push(json!({"type": "bold"})),
            "</strong>" | "</b>" => {
                self.marks.pop();
            }
            "<em>" | "<i>" => self.marks.push(json!({"type": "italic"})),
            "</em>" | "</i>" => {
                self.marks.pop();
            }
            "<s>" | "<del>" => self.marks.push(json!({"type": "strike"})),
            "</s>" | "</del>" => {
                self.marks.pop();
            }
            "<sup>" => self.marks.push(json!({"type": "superscript"})),
            "</sup>" => {
                self.marks.pop();
            }
            "<sub>" => self.marks.push(json!({"type": "subscript"})),
            "</sub>" => {
                self.marks.pop();
            }
            "<br>" | "<br/>" | "<br />" => {
                self.ensure_inline();
                if let Some(inline) = &mut self.inline {
                    inline.push(json!({"type": "hardBreak"}));
                }
            }
            _ => self.push_text_node(value, self.marks.clone()),
        }
    }

    fn push_text_node(&mut self, value: &str, marks: Vec<Value>) {
        if value.is_empty() {
            return;
        }
        self.ensure_inline();
        if let Some(inline) = &mut self.inline {
            let mut node = json!({"type": "text", "text": value});
            if !marks.is_empty() {
                node["marks"] = Value::Array(marks);
            }
            inline.push(node);
        }
    }

    fn ensure_inline(&mut self) {
        if self.inline.is_none() {
            self.inline = Some(Vec::new());
            self.heading = None;
        }
    }

    fn flush_inline(&mut self) {
        if let Some(content) = self.inline.take() {
            if content.is_empty() {
                return;
            }
            if let Some(level) = self.heading.take() {
                self.push_block(
                    json!({"type": "heading", "attrs": {"level": level}, "content": content}),
                );
            } else {
                self.push_block(json!({"type": "paragraph", "content": content}));
            }
        }
    }

    fn push_block(&mut self, block: Value) {
        if let Some(cell) = self.cells.last_mut() {
            cell.push(block);
        } else if let Some(item) = self.items.last_mut() {
            item.blocks.push(block);
        } else if let Some(container) = self.block_stack.last_mut() {
            container.push(block);
        } else {
            self.root.push(block);
        }
    }

    fn finish_image(&mut self, image: ImageCapture) {
        let dest = image.dest.trim();
        if !self.persist_assets {
            self.push_block(json!({"type": "paragraph", "content": [text("[图片]")]}));
            return;
        }
        if dest.starts_with("data:")
            && let Some((ext, bytes)) = crate::services::export_render::decode_data_url(dest)
            && let Ok(attachment) = attachment_service::upload_bytes(
                self.context,
                format!(
                    "{}-image-{}.{}",
                    self.asset_prefix,
                    self.attachment_count + 1,
                    ext
                ),
                "attach".to_string(),
                Some(format!(
                    "image/{}",
                    if ext == "jpg" { "jpeg" } else { &ext }
                )),
                bytes,
            )
        {
            self.attachment_count += 1;
            self.push_block(attachment_image_node(&attachment, &image.alt));
            return;
        }
        if is_remote(dest) {
            self.push_block(json!({
                "type": "image",
                "attrs": {"src": dest, "alt": image.alt, "title": image.title},
            }));
            return;
        }
        if let Some(path) = self.resolve_local(dest) {
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("image");
            if let Ok(attachment) = attachment_service::upload(
                self.context,
                UploadAttachmentInput {
                    source_path: path.to_string_lossy().into_owned(),
                    logical_path: "attach".to_string(),
                    name: Some(format!("{}-{}", self.asset_prefix, name)),
                    mime: None,
                    scope: Some("node".to_string()),
                    ttl_seconds: None,
                },
            ) {
                self.attachment_count += 1;
                self.push_block(attachment_image_node(&attachment, &image.alt));
                return;
            }
        }
        self.warnings
            .push(format!("图片未找到或无法导入：{dest}；已保留原路径"));
        self.push_block(json!({
            "type": "image",
            "attrs": {"src": dest, "alt": image.alt, "title": image.title},
        }));
    }

    fn resolve_local(&self, dest: &str) -> Option<PathBuf> {
        let decoded = percent_encoding::percent_decode_str(dest)
            .decode_utf8()
            .ok()?
            .into_owned();
        let path = self.source_dir.join(decoded.trim_start_matches("./"));
        path.is_file().then_some(path)
    }

    fn register_linked_file(&mut self, dest: &str) {
        if !self.persist_assets {
            return;
        }
        let Some(path) = self.resolve_local(dest) else {
            return;
        };
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("附件")
            .to_string();
        match attachment_service::upload(
            self.context,
            UploadAttachmentInput {
                source_path: path.to_string_lossy().into_owned(),
                logical_path: "attach".to_string(),
                name: Some(format!("{}-{}", self.asset_prefix, name)),
                mime: None,
                scope: Some("node".to_string()),
                ttl_seconds: None,
            },
        ) {
            Ok(attachment) => {
                self.attachment_count += 1;
                self.push_block(attachment_block_node(&[attachment]));
            }
            Err(error) => self.warnings.push(format!("本地链接附件导入失败：{error}")),
        }
    }
}

fn text(value: &str) -> Value {
    json!({"type": "text", "text": value})
}

fn attachment_image_node(
    attachment: &crate::models::attachment::AttachmentDto,
    alt: &str,
) -> Value {
    json!({
        "type": "attachmentImage",
        "attrs": {
            "attachmentId": attachment.id,
            "name": attachment.name,
            "size": attachment.size,
            "mime": attachment.mime,
            "alt": alt,
            "width": 0,
            "align": "left",
        },
    })
}

fn attachment_block_node(items: &[crate::models::attachment::AttachmentDto]) -> Value {
    json!({
        "type": "attachmentBlock",
        "attrs": {
            "variant": "list",
            "align": "left",
            "items": items.iter().map(|item| json!({
                "attachmentId": item.id,
                "name": item.name,
                "size": item.size,
                "mime": item.mime,
            })).collect::<Vec<_>>(),
        },
    })
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn is_remote(dest: &str) -> bool {
    let lower = dest.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("data:")
}

fn is_local_file(dest: &str) -> bool {
    let lower = dest.to_ascii_lowercase();
    !lower.starts_with("http://")
        && !lower.starts_with("https://")
        && !lower.starts_with("mailto:")
        && !lower.starts_with("tel:")
        && !lower.starts_with('#')
        && !lower.starts_with("data:")
        && !dest.trim().is_empty()
}
