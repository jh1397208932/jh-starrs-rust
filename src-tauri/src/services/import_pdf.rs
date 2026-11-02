//! PDF 导入：用 pdf-inspector 抽取 Markdown，再交给 Markdown 解析器生成 Tiptap 块。
//!
//! 只处理文本型/混合型 PDF；扫描件需要 OCR，本轮不启用（无模型、无外部服务），
//! 导入结果保留原始 PDF 并给出明确提示，不生成空文档。

use std::fs;
use std::path::Path;

use pdf_inspector::{PdfType, process_pdf};
use serde_json::{Value, json};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::services::attachment_service::AttachmentContext;
use crate::services::import_markdown::parse_markdown;

/// 单份 PDF 上限；超过说明用户应拆分或先压缩。
const MAX_PDF_BYTES: u64 = 128 * 1024 * 1024;

pub struct ParsedPdf {
    pub blocks: Vec<Value>,
    pub warnings: Vec<String>,
    pub attachment_count: usize,
}

/// 解析 PDF 正文；扫描件返回带提示的单段，不视为解析失败。
pub fn parse_pdf(
    context: &AttachmentContext,
    source: &Path,
    asset_prefix: &str,
) -> AppResult<ParsedPdf> {
    let metadata = fs::metadata(source).map_err(|error| {
        logging::error("import.pdf", &format!("读取 PDF 元数据失败: {error}"));
        AppError::validation("PDF 文件不存在或不可读取")
    })?;
    if !metadata.is_file() {
        return Err(AppError::validation("只能导入普通文件"));
    }
    if metadata.len() > MAX_PDF_BYTES {
        return Err(AppError::validation("文件太大，暂时无法导入"));
    }

    let result = process_pdf(source).map_err(|error| {
        logging::error(
            "import.pdf",
            &format!("PDF 解析失败 path={} error={error}", source.display()),
        );
        AppError::validation("无法读取这个 PDF，文件可能已损坏或有密码")
    })?;

    logging::info(
        "import.pdf",
        &format!(
            "PDF 分类={:?} pages={} confidence={:.2} time={}ms",
            result.pdf_type, result.page_count, result.confidence, result.processing_time_ms
        ),
    );

    let mut warnings = Vec::new();
    if result.has_encoding_issues {
        warnings.push("部分文字可能无法正确显示".to_string());
    }
    if !result.pages_needing_ocr.is_empty() {
        warnings.push(format!(
            "有 {} 页是图片，未提取文字",
            result.pages_needing_ocr.len()
        ));
    }

    if matches!(result.pdf_type, PdfType::Scanned | PdfType::ImageBased) {
        return Ok(ParsedPdf {
            blocks: vec![notice("这个 PDF 是图片版，暂时无法提取文字。")],
            warnings,
            attachment_count: 0,
        });
    }

    let markdown = result.markdown.unwrap_or_default();
    if markdown.trim().is_empty() {
        warnings.push("没有提取到文字".to_string());
        return Ok(ParsedPdf {
            blocks: vec![notice("没有提取到文字，原始文件已作为附件保留。")],
            warnings,
            attachment_count: 0,
        });
    }

    let parsed = parse_markdown(context, source, &markdown, asset_prefix)?;
    warnings.extend(parsed.warnings);
    Ok(ParsedPdf {
        blocks: parsed.blocks,
        warnings,
        attachment_count: parsed.attachment_count,
    })
}

fn notice(text: &str) -> Value {
    json!({
        "type": "paragraph",
        "content": [{"type": "text", "text": text}],
    })
}
