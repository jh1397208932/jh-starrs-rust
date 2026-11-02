//! 文档导出渲染：Markdown / HTML / Word / PDF。
//!
//! 渲染层只消费已整理好的 `RenderContext`（正文 + 附件相对路径 + 图片字节），
//! 不查询数据库、不决定导出目录；路径与落盘由 `export_service` 负责。

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

use base64::Engine as _;
use docx_rs::{
    AlignmentType, BreakType, Docx, Paragraph, Pic, Run, RunFonts, Table, TableCell, TableRow,
    VertAlignType,
};
use html_escape::{encode_double_quoted_attribute as encode_attribute, encode_text};
use printpdf::{GeneratePdfOptions, PdfDocument, PdfSaveOptions};
use serde_json::Value;

use crate::domain::document::to_markdown;
use crate::errors::{AppError, AppResult};
use crate::logging;

/// 一个已落盘的附件。
#[derive(Debug, Clone)]
pub struct RenderAttachment {
    pub name: String,
    /// 相对导出文件所在目录的路径（用于 Markdown/HTML 链接）。
    pub rel_path: String,
    /// 图片等需要内嵌到 Word/PDF 的字节；大文件或非图片为 None。
    pub bytes: Option<Vec<u8>>,
}

/// 一次渲染需要的全部输入。
#[derive(Debug, Clone, Default)]
pub struct RenderContext {
    pub title: String,
    pub document: Value,
    /// attachmentId → 已落盘附件。
    pub attachments: BTreeMap<String, RenderAttachment>,
    /// 相对路径 → 图片字节（附件图片、内联 base64 图片）。
    pub images: BTreeMap<String, Vec<u8>>,
    pub warnings: Vec<String>,
}

/// Markdown 渲染：复用派生 Markdown，替换附件 token 为相对路径。
pub fn render_markdown(ctx: &RenderContext) -> String {
    let mut markdown = to_markdown(&ctx.document);
    if !first_block_is_title(ctx) {
        markdown = format!("# {}\n\n{}", ctx.title.replace('\n', " "), markdown);
    }
    for (id, attachment) in &ctx.attachments {
        markdown = markdown.replace(
            &format!("attachment://{id}"),
            &encode_relative_path(&attachment.rel_path),
        );
    }
    for warning in &ctx.warnings {
        logging::debug("export.markdown", warning);
    }
    markdown
}

fn first_block_is_title(ctx: &RenderContext) -> bool {
    let first = ctx
        .document
        .get("content")
        .and_then(Value::as_array)
        .and_then(|blocks| blocks.first());
    let Some(first) = first else {
        return false;
    };
    first.get("type").and_then(Value::as_str) == Some("heading")
        && attrs(first).get("level").and_then(Value::as_u64) == Some(1)
        && inline_plain(first).trim() == ctx.title.trim()
}

/// HTML 渲染：独立 HTML 文档，带打印样式。
pub fn render_html(ctx: &RenderContext) -> String {
    let mut body = String::new();
    if !first_block_is_title(ctx) {
        let _ = write!(body, "<h1>{}</h1>", encode_text(&ctx.title));
    }
    body.push_str(&render_html_blocks(ctx, children(&ctx.document)));
    let title = encode_text(&ctx.title);
    format!(
        r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<style>
:root {{ color-scheme: light; }}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; padding: 48px 24px; background: #f6f5f1; color: #202321;
  font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif;
  line-height: 1.75; font-size: 15.5px;
}}
main {{ max-width: 820px; margin: 0 auto; background: #fff; border: 1px solid #e6e2da;
  border-radius: 16px; padding: 48px 56px; box-shadow: 0 12px 36px rgba(32,35,33,.06); }}
h1 {{ font-size: 30px; line-height: 1.3; margin: 0 0 18px; }}
h2 {{ font-size: 22px; margin: 28px 0 10px; }} h3 {{ font-size: 18px; margin: 22px 0 8px; }}
p {{ margin: 0 0 12px; }}
blockquote {{ margin: 14px 0; padding: 8px 16px; border-left: 3px solid #6d8f80; color: #555; background: #f4f7f5; }}
code {{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em;
  background: #f1f0ec; border-radius: 5px; padding: 1px 5px; }}
pre {{ overflow: auto; background: #1f2320; color: #f4f4ef; border-radius: 10px; padding: 14px 16px; }}
pre code {{ background: transparent; color: inherit; padding: 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 14px; }}
th, td {{ border: 1px solid #dcd8d0; padding: 7px 10px; text-align: left; vertical-align: top; }}
th {{ background: #f4f2ed; }}
img {{ max-width: 100%; height: auto; border-radius: 8px; }}
figure {{ margin: 14px 0; }} figcaption {{ color: #777; font-size: 12.5px; }}
.attachments {{ margin: 12px 0; padding: 10px 12px; background: #f7f6f2; border: 1px solid #e6e2da; border-radius: 8px; }}
.attachments a {{ display: block; color: #2f6f5e; text-decoration: none; }}
.task-list {{ list-style: none; padding-left: 0; }} .task-list li {{ display: flex; gap: 8px; }}
details {{ margin: 12px 0; }} summary {{ cursor: pointer; font-weight: 600; }}
.raw-node {{ background: #fff8e8; border: 1px dashed #d6b26a; padding: 10px; white-space: pre-wrap; }}
@media print {{
  body {{ background: #fff; padding: 0; font-size: 12pt; }}
  main {{ max-width: none; border: 0; border-radius: 0; padding: 0; box-shadow: none; }}
  pre {{ white-space: pre-wrap; }}
}}
</style>
</head>
<body><main>{body}</main></body>
</html>
"#
    )
}

/// Word 渲染：标题 + 正文，图片内嵌。
pub fn render_docx(ctx: &RenderContext, dest: &Path) -> AppResult<()> {
    let mut docx = Docx::new();
    if !first_block_is_title(ctx) {
        docx = docx.add_paragraph(
            Paragraph::new()
                .style("Heading1")
                .add_run(Run::new().add_text(&ctx.title)),
        );
    }
    for block in children(&ctx.document) {
        docx = add_docx_block(docx, block, ctx, 0);
    }
    let file = fs::File::create(dest).map_err(|error| {
        logging::error("export.docx", &format!("创建 docx 失败: {error}"));
        AppError::FileSystem
    })?;
    docx.build().pack(file).map_err(|error| {
        logging::error("export.docx", &format!("写入 docx 失败: {error}"));
        AppError::Internal
    })?;
    Ok(())
}

/// PDF 渲染：用 HTML 排版后走 printpdf；字体由系统 fontconfig 解析。
pub fn render_pdf(ctx: &RenderContext, dest: &Path) -> AppResult<()> {
    let html = render_html(ctx);
    let mut images = BTreeMap::new();
    for (path, bytes) in &ctx.images {
        images.insert(path.clone(), printpdf::Base64OrRaw::Raw(bytes.clone()));
    }
    let fonts = BTreeMap::new();
    let options = GeneratePdfOptions {
        page_width: Some(210.0),
        page_height: Some(297.0),
        margin_top: Some(18.0),
        margin_bottom: Some(18.0),
        margin_left: Some(16.0),
        margin_right: Some(16.0),
        ..Default::default()
    };
    let mut warnings = Vec::new();
    let pdf = PdfDocument::from_html(&html, &images, &fonts, &options, &mut warnings).map_err(
        |error| {
            logging::error("export.pdf", &format!("HTML→PDF 失败: {error}"));
            AppError::Internal
        },
    )?;
    for warning in warnings {
        logging::debug("export.pdf", &format!("{warning:?}"));
    }
    let bytes = pdf.save(&PdfSaveOptions::default(), &mut Vec::new());
    fs::write(dest, bytes).map_err(|error| {
        logging::error("export.pdf", &format!("写入 PDF 失败: {error}"));
        AppError::FileSystem
    })?;
    Ok(())
}

fn add_docx_block(mut docx: Docx, block: &Value, ctx: &RenderContext, indent: usize) -> Docx {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match block_type {
        "heading" => {
            let level = attrs(block)
                .get("level")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6);
            let paragraph = Paragraph::new()
                .style(&format!("Heading{level}"))
                .add_run(Run::new().add_text(inline_plain(block)));
            docx = docx.add_paragraph(paragraph);
        }
        "paragraph" => {
            let mut paragraph = Paragraph::new();
            if let Some(align) = text_align(block) {
                paragraph = paragraph.align(align);
            }
            if indent > 0 {
                paragraph = paragraph.indent(Some(indent as i32 * 360), None, None, None);
            }
            paragraph = add_docx_inline(paragraph, block, ctx);
            docx = docx.add_paragraph(paragraph);
        }
        "bulletList" | "orderedList" | "taskList" => {
            let ordered = block_type == "orderedList";
            for (index, item) in children(block).iter().enumerate() {
                let marker = if ordered {
                    format!("{}. ", index + 1)
                } else {
                    "• ".to_string()
                };
                let item_text = children(item)
                    .iter()
                    .filter(|child| child.get("type").and_then(Value::as_str) == Some("paragraph"))
                    .map(inline_plain)
                    .collect::<Vec<_>>()
                    .join(" ");
                let paragraph = Paragraph::new()
                    .indent(Some(indent as i32 * 360), None, None, None)
                    .add_run(Run::new().add_text(format!("{marker}{item_text}")));
                docx = docx.add_paragraph(paragraph);
                for child in children(item) {
                    if child.get("type").and_then(Value::as_str) != Some("paragraph") {
                        docx = add_docx_block(docx, child, ctx, indent + 1);
                    }
                }
            }
        }
        "blockquote" => {
            for child in children(block) {
                docx = add_docx_block(docx, child, ctx, indent + 1);
            }
        }
        "codeBlock" => {
            let code = block
                .get("content")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.get("text").and_then(Value::as_str))
                        .collect::<String>()
                })
                .unwrap_or_default();
            let paragraph = Paragraph::new()
                .indent(Some(360), None, None, None)
                .add_run(
                    Run::new().add_text(code).fonts(
                        RunFonts::new()
                            .ascii("Courier New")
                            .east_asia("PingFang SC"),
                    ),
                );
            docx = docx.add_paragraph(paragraph);
        }
        "horizontalRule" => {
            docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text("────────")));
        }
        "image" => {
            if let Some(path) = block
                .get("attrs")
                .and_then(|a| a.get("src"))
                .and_then(Value::as_str)
            {
                if let Some(pic) = ctx.images.get(path).and_then(|bytes| pic_from_bytes(bytes)) {
                    docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_image(pic)));
                } else {
                    docx = docx.add_paragraph(
                        Paragraph::new().add_run(Run::new().add_text(format!("[图片] {path}"))),
                    );
                }
            }
        }
        "attachmentImage" => {
            let id = attrs(block)
                .get("attachmentId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if let Some(attachment) = ctx.attachments.get(id)
                && let Some(pic) = attachment.bytes.as_deref().and_then(pic_from_bytes)
            {
                docx = docx.add_paragraph(Paragraph::new().add_run(Run::new().add_image(pic)));
            } else {
                docx = docx
                    .add_paragraph(Paragraph::new().add_run(Run::new().add_text("[图片附件缺失]")));
            }
        }
        "attachmentBlock" => {
            let items = attrs(block).get("items").and_then(Value::as_array);
            if let Some(items) = items {
                for item in items {
                    let id = item
                        .get("attachmentId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("附件");
                    let path = ctx
                        .attachments
                        .get(id)
                        .map_or("attach/", |a| a.rel_path.as_str());
                    docx = docx.add_paragraph(
                        Paragraph::new()
                            .add_run(Run::new().add_text(format!("附件：{name}（{path}）"))),
                    );
                }
            }
        }
        "boardEmbed" | "mindmapEmbed" => {
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_text(embed_placeholder_text(block))),
            );
        }
        "table" => {
            let rows = children(block)
                .iter()
                .filter(|row| row.get("type").and_then(Value::as_str) == Some("tableRow"))
                .map(|row| {
                    let cells = children(row)
                        .iter()
                        .map(|cell| {
                            let is_header =
                                cell.get("type").and_then(Value::as_str) == Some("tableHeader");
                            let mut paragraph = Paragraph::new();
                            if is_header {
                                paragraph = paragraph.bold();
                            }
                            paragraph = add_docx_inline(paragraph, cell, ctx);
                            TableCell::new().add_paragraph(paragraph)
                        })
                        .collect();
                    TableRow::new(cells)
                })
                .collect();
            docx = docx.add_table(Table::new(rows));
        }
        "details" => {
            let summary = children(block)
                .iter()
                .find(|child| child.get("type").and_then(Value::as_str) == Some("detailsSummary"))
                .map(inline_plain)
                .unwrap_or_default();
            docx =
                docx.add_paragraph(Paragraph::new().add_run(Run::new().add_text(summary).bold()));
            for child in children(block) {
                if child.get("type").and_then(Value::as_str) != Some("detailsSummary") {
                    docx = add_docx_block(docx, child, ctx, indent);
                }
            }
        }
        "hardBreak" => {
            docx = docx.add_paragraph(
                Paragraph::new().add_run(Run::new().add_break(BreakType::TextWrapping)),
            );
        }
        "emoji" => {
            let name = attrs(block)
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            docx = docx
                .add_paragraph(Paragraph::new().add_run(Run::new().add_text(format!(":{name}:"))));
        }
        _ => {
            // 未知块不静默丢失：以可读原文（JSON）落到 Word 中。
            let raw = serde_json::to_string(block).unwrap_or_default();
            docx = docx.add_paragraph(
                Paragraph::new().add_run(
                    Run::new()
                        .add_text(format!("[未识别块 {block_type}] {raw}"))
                        .fonts(
                            RunFonts::new()
                                .ascii("Courier New")
                                .east_asia("PingFang SC"),
                        ),
                ),
            );
        }
    }
    docx
}

fn add_docx_inline(mut paragraph: Paragraph, node: &Value, ctx: &RenderContext) -> Paragraph {
    for child in children(node) {
        let child_type = child
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match child_type {
            "text" => {
                let text = child
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mut run = Run::new().add_text(text);
                for mark in child
                    .get("marks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    match mark.get("type").and_then(Value::as_str) {
                        Some("bold") => run = run.bold(),
                        Some("italic") => run = run.italic(),
                        Some("strike") => run = run.strike(),
                        Some("underline") => run = run.underline("single"),
                        Some("code") => {
                            run = run.fonts(
                                RunFonts::new()
                                    .ascii("Courier New")
                                    .east_asia("PingFang SC"),
                            )
                        }
                        Some("subscript") => {
                            run.run_property =
                                run.run_property.vert_align(VertAlignType::SubScript);
                        }
                        Some("superscript") => {
                            run.run_property =
                                run.run_property.vert_align(VertAlignType::SuperScript);
                        }
                        Some("textStyle") => {
                            if let Some(color) = mark
                                .get("attrs")
                                .and_then(|a| a.get("color"))
                                .and_then(Value::as_str)
                                .and_then(hex_color)
                            {
                                run = run.color(color);
                            }
                        }
                        Some("highlight") => {
                            if let Some(color) = mark
                                .get("attrs")
                                .and_then(|a| a.get("color"))
                                .and_then(Value::as_str)
                                .and_then(hex_color)
                            {
                                run = run.highlight(color);
                            }
                        }
                        Some("link") => {
                            let href = mark
                                .get("attrs")
                                .and_then(|a| a.get("href"))
                                .and_then(Value::as_str)
                                .unwrap_or_default();
                            if !href.is_empty() {
                                run = run.add_text(format!(" ({href})"));
                            }
                        }
                        _ => {}
                    }
                }
                paragraph = paragraph.add_run(run);
            }
            "hardBreak" => {
                paragraph = paragraph.add_run(Run::new().add_break(BreakType::TextWrapping));
            }
            "image" | "attachmentImage" => {
                let path = if child_type == "image" {
                    child
                        .get("attrs")
                        .and_then(|a| a.get("src"))
                        .and_then(Value::as_str)
                } else {
                    let id = child
                        .get("attrs")
                        .and_then(|a| a.get("attachmentId"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    ctx.attachments.get(id).map(|a| a.rel_path.as_str())
                };
                if let Some(path) = path
                    && let Some(pic) = ctx.images.get(path).and_then(|bytes| pic_from_bytes(bytes))
                {
                    paragraph = paragraph.add_run(Run::new().add_image(pic));
                }
            }
            "emoji" => {
                let name = child
                    .get("attrs")
                    .and_then(|a| a.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                paragraph = paragraph.add_run(Run::new().add_text(format!(":{name}:")));
            }
            _ => {
                paragraph = add_docx_inline(paragraph, child, ctx);
            }
        }
    }
    paragraph
}

fn pic_from_bytes(bytes: &[u8]) -> Option<Pic> {
    // docx-rs 的 Pic::new 对无法解码的图片会 panic；导出不能因一张图崩溃。
    let pic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| Pic::new(bytes))).ok()?;
    // 限制超大图片的显示尺寸，避免撑破 Word 页面；保留原始比例。
    let (w, h) = pic.size;
    let max_w = 600_u32 * 9525;
    if w > max_w {
        let scaled_h = (h as u64 * max_w as u64 / w.max(1) as u64) as u32;
        Some(pic.size(max_w, scaled_h.max(1)))
    } else {
        Some(pic)
    }
}

fn render_html_blocks(ctx: &RenderContext, blocks: &[Value]) -> String {
    let mut out = String::new();
    for block in blocks {
        render_html_block(ctx, block, &mut out);
    }
    out
}

fn render_html_block(ctx: &RenderContext, node: &Value, out: &mut String) {
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
    match node_type {
        "paragraph" => {
            let style = text_align_style(node);
            out.push_str(&format!("<p{style}>"));
            render_html_inline(ctx, node, out);
            out.push_str("</p>");
        }
        "heading" => {
            let level = attrs(node)
                .get("level")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6);
            let style = text_align_style(node);
            let _ = write!(out, "<h{level}{style}>");
            render_html_inline(ctx, node, out);
            let _ = write!(out, "</h{level}>");
        }
        "bulletList" | "orderedList" | "taskList" => {
            let tag = if node_type == "orderedList" {
                "ol"
            } else {
                "ul"
            };
            let class = if node_type == "taskList" {
                " class=\"task-list\""
            } else {
                ""
            };
            let _ = write!(out, "<{tag}{class}>");
            for item in children(node) {
                render_html_block(ctx, item, out);
            }
            let _ = write!(out, "</{tag}>");
        }
        "listItem" | "taskItem" => {
            let checked = node
                .get("attrs")
                .and_then(|a| a.get("checked"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            out.push_str("<li>");
            if node_type == "taskItem" {
                let _ = write!(
                    out,
                    "<input type=\"checkbox\" disabled{} />",
                    if checked { " checked" } else { "" }
                );
            }
            for child in children(node) {
                render_html_block(ctx, child, out);
            }
            out.push_str("</li>");
        }
        "blockquote" => {
            out.push_str("<blockquote>");
            for child in children(node) {
                render_html_block(ctx, child, out);
            }
            out.push_str("</blockquote>");
        }
        "codeBlock" => {
            let language = attrs(node)
                .get("language")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let code = node
                .get("content")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.get("text").and_then(Value::as_str))
                        .collect::<String>()
                })
                .unwrap_or_default();
            let class = if language.is_empty() {
                String::new()
            } else {
                format!(" class=\"language-{}\"", encode_attribute(language))
            };
            let _ = write!(out, "<pre><code{class}>{}</code></pre>", encode_text(&code));
        }
        "horizontalRule" => out.push_str("<hr />"),
        "image" => {
            let src = attrs(node)
                .get("src")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let alt = attrs(node).get("alt").and_then(Value::as_str).unwrap_or("");
            if !src.is_empty() {
                let _ = write!(
                    out,
                    "<figure><img src=\"{}\" alt=\"{}\" /></figure>",
                    encode_attribute(src),
                    encode_attribute(alt)
                );
            }
        }
        "attachmentImage" => {
            let id = attrs(node)
                .get("attachmentId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let alt = attrs(node)
                .get("alt")
                .or_else(|| attrs(node).get("name"))
                .and_then(Value::as_str)
                .unwrap_or("图片");
            if let Some(attachment) = ctx.attachments.get(id) {
                let _ = write!(
                    out,
                    "<figure><img src=\"{}\" alt=\"{}\" /><figcaption>{}</figcaption></figure>",
                    encode_attribute(&attachment.rel_path),
                    encode_attribute(alt),
                    encode_text(alt)
                );
            } else {
                let _ = write!(
                    out,
                    "<p class=\"raw-node\">[图片附件缺失] {}</p>",
                    encode_text(alt)
                );
            }
        }
        "attachmentBlock" => {
            out.push_str("<div class=\"attachments\">");
            if let Some(items) = attrs(node).get("items").and_then(Value::as_array) {
                for item in items {
                    let id = item
                        .get("attachmentId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let name = item.get("name").and_then(Value::as_str).unwrap_or("附件");
                    if let Some(attachment) = ctx.attachments.get(id) {
                        let fallback_name = if name.is_empty() {
                            attachment.name.as_str()
                        } else {
                            name
                        };
                        let _ = write!(
                            out,
                            "<a href=\"{}\">📎 {}</a>",
                            encode_attribute(&attachment.rel_path),
                            encode_text(fallback_name)
                        );
                    } else {
                        let _ = write!(out, "<span>📎 {}</span>", encode_text(name));
                    }
                }
            }
            out.push_str("</div>");
        }
        "boardEmbed" | "mindmapEmbed" => {
            let _ = write!(
                out,
                "<figure class=\"embed-placeholder\"><figcaption>{}</figcaption><p>内嵌预览，请在 Starris 中查看。</p></figure>",
                encode_text(&embed_placeholder_text(node))
            );
        }
        "table" => {
            out.push_str("<table>");
            for row in children(node) {
                out.push_str("<tr>");
                for cell in children(row) {
                    let tag = if cell.get("type").and_then(Value::as_str) == Some("tableHeader") {
                        "th"
                    } else {
                        "td"
                    };
                    let _ = write!(out, "<{tag}>");
                    for child in children(cell) {
                        render_html_block(ctx, child, out);
                    }
                    let _ = write!(out, "</{tag}>");
                }
                out.push_str("</tr>");
            }
            out.push_str("</table>");
        }
        "details" => {
            out.push_str("<details>");
            for child in children(node) {
                if child.get("type").and_then(Value::as_str) == Some("detailsSummary") {
                    out.push_str("<summary>");
                    render_html_inline(ctx, child, out);
                    out.push_str("</summary>");
                } else {
                    render_html_block(ctx, child, out);
                }
            }
            out.push_str("</details>");
        }
        "hardBreak" => out.push_str("<br />"),
        "emoji" => {
            let name = attrs(node)
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let _ = write!(out, ":{name}:");
        }
        "text" => {
            render_html_inline(ctx, node, out);
        }
        _ => {
            let raw = serde_json::to_string_pretty(node).unwrap_or_default();
            let _ = write!(out, "<pre class=\"raw-node\">{}</pre>", encode_text(&raw));
        }
    }
}

fn render_html_inline(ctx: &RenderContext, node: &Value, out: &mut String) {
    for child in children(node) {
        match child
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "text" => {
                let text = child
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let mut rendered = encode_text(text).to_string();
                for mark in child
                    .get("marks")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    match mark.get("type").and_then(Value::as_str) {
                        Some("bold") => rendered = format!("<strong>{rendered}</strong>"),
                        Some("italic") => rendered = format!("<em>{rendered}</em>"),
                        Some("strike") => rendered = format!("<s>{rendered}</s>"),
                        Some("underline") => rendered = format!("<u>{rendered}</u>"),
                        Some("code") => rendered = format!("<code>{rendered}</code>"),
                        Some("subscript") => rendered = format!("<sub>{rendered}</sub>"),
                        Some("superscript") => rendered = format!("<sup>{rendered}</sup>"),
                        Some("highlight") => {
                            if let Some(color) = mark
                                .get("attrs")
                                .and_then(|a| a.get("color"))
                                .and_then(Value::as_str)
                                .and_then(hex_color)
                            {
                                rendered = format!(
                                    "<mark style=\"background:#{color}\">{rendered}</mark>"
                                );
                            }
                        }
                        Some("textStyle") => {
                            if let Some(color) = mark
                                .get("attrs")
                                .and_then(|a| a.get("color"))
                                .and_then(Value::as_str)
                                .and_then(hex_color)
                            {
                                rendered =
                                    format!("<span style=\"color:#{color}\">{rendered}</span>");
                            }
                        }
                        Some("link") => {
                            if let Some(href) = mark
                                .get("attrs")
                                .and_then(|a| a.get("href"))
                                .and_then(Value::as_str)
                                .filter(|href| is_safe_href(href))
                            {
                                rendered = format!(
                                    "<a href=\"{}\">{rendered}</a>",
                                    encode_attribute(href)
                                );
                            }
                        }
                        _ => {}
                    }
                }
                out.push_str(&rendered);
            }
            "hardBreak" => out.push_str("<br />"),
            "image" => {
                let src = child
                    .get("attrs")
                    .and_then(|a| a.get("src"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !src.is_empty() {
                    let _ = write!(out, "<img src=\"{}\" alt=\"\" />", encode_attribute(src));
                }
            }
            "attachmentImage" => render_html_block(ctx, child, out),
            "emoji" => {
                let name = child
                    .get("attrs")
                    .and_then(|a| a.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let _ = write!(out, ":{name}:");
            }
            _ => render_html_inline(ctx, child, out),
        }
    }
}

fn children(node: &Value) -> &[Value] {
    node.get("content")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

/// 内嵌预览的导出占位：不静默丢块，也不在导出里伪造图片。
fn embed_placeholder_text(node: &Value) -> String {
    let label = if node.get("type").and_then(Value::as_str) == Some("boardEmbed") {
        "画板"
    } else {
        "思维导图"
    };
    let title = attrs(node)
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if title.is_empty() {
        format!("{label}（内嵌预览，请在 Starris 中查看）")
    } else {
        format!("{label}：{title}（内嵌预览，请在 Starris 中查看）")
    }
}

fn attrs(node: &Value) -> &serde_json::Map<String, Value> {
    node.get("attrs")
        .and_then(Value::as_object)
        .unwrap_or_else(|| {
            static EMPTY: std::sync::OnceLock<serde_json::Map<String, Value>> =
                std::sync::OnceLock::new();
            EMPTY.get_or_init(serde_json::Map::new)
        })
}

fn inline_plain(node: &Value) -> String {
    let mut text = String::new();
    for child in children(node) {
        match child
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "text" => text.push_str(
                child
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ),
            "hardBreak" => text.push('\n'),
            "emoji" => {
                let name = child
                    .get("attrs")
                    .and_then(|a| a.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let _ = write!(text, ":{name}:");
            }
            _ => text.push_str(&inline_plain(child)),
        }
    }
    text
}

fn text_align(node: &Value) -> Option<AlignmentType> {
    match attrs(node).get("textAlign").and_then(Value::as_str) {
        Some("center") => Some(AlignmentType::Center),
        Some("right") => Some(AlignmentType::Right),
        Some("justify") => Some(AlignmentType::Both),
        _ => None,
    }
}

fn text_align_style(node: &Value) -> String {
    match attrs(node).get("textAlign").and_then(Value::as_str) {
        Some("center") => " style=\"text-align:center\"".to_string(),
        Some("right") => " style=\"text-align:right\"".to_string(),
        Some("justify") => " style=\"text-align:justify\"".to_string(),
        _ => String::new(),
    }
}

fn hex_color(raw: &str) -> Option<String> {
    let value = raw.trim().trim_start_matches('#');
    if value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Some(value.to_ascii_uppercase())
    } else {
        None
    }
}

fn is_safe_href(href: &str) -> bool {
    let lower = href.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with('#')
        || lower.starts_with('/')
        || (!lower.contains(':') && !lower.is_empty())
}

fn encode_relative_path(path: &str) -> String {
    const PATH_SEGMENT: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
        .add(b' ')
        .add(b'"')
        .add(b'#')
        .add(b'%')
        .add(b'?')
        .add(b'[')
        .add(b']')
        .add(b'(')
        .add(b')');
    path.split('/')
        .map(|segment| percent_encoding::utf8_percent_encode(segment, PATH_SEGMENT).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// 从 data URL 解码图片；返回扩展名与字节。
pub fn decode_data_url(src: &str) -> Option<(String, Vec<u8>)> {
    let (meta, payload) = src.strip_prefix("data:")?.split_once(',')?;
    let mime = meta.split(';').next().unwrap_or("image/png");
    let bytes = if meta.contains(";base64") {
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .ok()?
    } else {
        percent_encoding::percent_decode_str(payload).collect()
    };
    let ext = match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };
    Some((ext.to_string(), bytes))
}
