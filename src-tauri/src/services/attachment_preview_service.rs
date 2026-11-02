//! 附件预览：图片之外的常用格式（纯文本 / Markdown / Word）在应用内直接查看。
//!
//! Markdown 与 Word 复用导入用的同一套解析（`import_markdown` / `import_word`），
//! 以「预览模式」调用：只产出块 JSON，不把内嵌图片或本地链接写进附件库 —— 否则
//! 用户只是看一眼文档，附件总大小就会变化。图片预览仍走 `attachment_read_bytes`。

use std::path::Path;
use std::sync::OnceLock;
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::domain::attachment::TEMP_DIR_RELATIVE;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::AttachmentDto;
use crate::repositories::attachment_repository as repository;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::attachment_store;
use crate::services::{import_markdown, import_word};

/// 纯文本预览上限：超出只读前 512 KB，并在界面上标注已截断。
const MAX_TEXT_BYTES: i64 = 512 * 1024;
/// Word / Markdown 必须整份解析，超过这个体积直接拒绝预览。
const MAX_DOCUMENT_BYTES: i64 = 8 * 1024 * 1024;
/// 块预览最多返回多少块，避免超大文档把界面撑爆。
const MAX_PREVIEW_BLOCKS: usize = 400;
/// 预览缓存单条上限：超过就只算不存，避免一部长文档把工作区库撑大。
const MAX_CACHED_PREVIEW_BYTES: usize = 2 * 1024 * 1024;
/// 写入时预转换的队列容量；满时丢弃（下次打开预览会现算并回填）。
const PRECOMPUTE_QUEUE_CAPACITY: usize = 16;

/// 预览结果。图片不在本命令范围内（由图片预览链路单独处理）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AttachmentPreviewDto {
    /// 纯文本：原文 + 是否因体积被截断
    Text { text: String, truncated: bool },
    /// 结构化正文：format 为 markdown / docx，blocks 为编辑器同款块 JSON
    Blocks {
        format: String,
        blocks: Vec<Value>,
        truncated: bool,
    },
    /// 不支持预览（由界面显示「可下载后查看」）
    Unsupported,
}

/// 预览分派类型；与前端按扩展名/MIME 的判定保持一致。
enum PreviewKind {
    Image,
    Text,
    Markdown,
    Word,
    None,
}

/// 按名称扩展名与 MIME 判定预览类型。
fn preview_kind(attachment: &AttachmentDto) -> PreviewKind {
    if attachment.mime.starts_with("image/") {
        return PreviewKind::Image;
    }
    let extension = Path::new(&attachment.name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "txt" || attachment.mime == "text/plain" {
        return PreviewKind::Text;
    }
    if extension == "md" || extension == "markdown" || attachment.mime == "text/markdown" {
        return PreviewKind::Markdown;
    }
    if matches!(
        extension.as_str(),
        "docx" | "docm" | "dotx" | "dotm" | "doc"
    ) {
        return PreviewKind::Word;
    }
    PreviewKind::None
}

/// 缓存里的类型标签。
fn kind_label(dto: &AttachmentPreviewDto) -> &'static str {
    match dto {
        AttachmentPreviewDto::Text { .. } => "text",
        AttachmentPreviewDto::Blocks { .. } => "blocks",
        AttachmentPreviewDto::Unsupported => "unsupported",
    }
}

/// 判断某附件能否在应用内预览，并给出预览内容。
///
/// 读取顺序：库里预转换好的结果（写入时已生成）→ 兜底现算并回填。
///
/// @param context 当前工作区附件上下文
/// @param node_id 附件节点 id（不是附件 id）
/// @returns 文本 / 块 / 不支持三种结果之一
pub fn preview(context: &AttachmentContext, node_id: &str) -> AppResult<AttachmentPreviewDto> {
    let attachment = attachment_service::get_by_node(context, node_id)?;
    preview_for_attachment(context, &attachment)
}

pub(crate) fn preview_for_attachment(
    context: &AttachmentContext,
    attachment: &AttachmentDto,
) -> AppResult<AttachmentPreviewDto> {
    if matches!(preview_kind(attachment), PreviewKind::Image) {
        return Ok(AttachmentPreviewDto::Unsupported);
    }
    if let Some(cached) = read_cached(context, attachment) {
        return Ok(cached);
    }
    let dto = compute_preview(context, attachment)?;
    store_cached(context, attachment, &dto);
    Ok(dto)
}

/// 读缓存：只有来源时间与附件当前时间一致、且类型标签对得上才采用。
fn read_cached(
    context: &AttachmentContext,
    attachment: &AttachmentDto,
) -> Option<AttachmentPreviewDto> {
    let connection = context.connection().ok()?;
    let (kind, payload, source_updated_at) =
        repository::get_preview(&connection, &attachment.id).ok()??;
    if source_updated_at != attachment.updated_at {
        return None;
    }
    let dto: AttachmentPreviewDto = serde_json::from_str(&payload).ok()?;
    if kind_label(&dto) != kind {
        return None;
    }
    Some(dto)
}

/// 回填缓存；失败只记 debug 日志，不影响本次预览返回。
fn store_cached(
    context: &AttachmentContext,
    attachment: &AttachmentDto,
    dto: &AttachmentPreviewDto,
) {
    if matches!(dto, AttachmentPreviewDto::Unsupported) {
        return;
    }
    let Ok(payload) = serde_json::to_string(dto) else {
        return;
    };
    if payload.len() > MAX_CACHED_PREVIEW_BYTES {
        return;
    }
    let Ok(connection) = context.connection() else {
        return;
    };
    if let Err(error) = repository::upsert_preview(
        &connection,
        &attachment.id,
        kind_label(dto),
        &payload,
        attachment.updated_at,
    ) {
        logging::debug(
            "attachment.preview",
            &format!("预览缓存写入失败 id={}: {error}", attachment.id),
        );
    }
}

/// 真正执行转换；只在缓存缺失或过期时调用。
fn compute_preview(
    context: &AttachmentContext,
    attachment: &AttachmentDto,
) -> AppResult<AttachmentPreviewDto> {
    match preview_kind(attachment) {
        PreviewKind::Image | PreviewKind::None => Ok(AttachmentPreviewDto::Unsupported),
        PreviewKind::Text => {
            let bytes = read_object(context, &attachment.id, MAX_TEXT_BYTES)?;
            Ok(AttachmentPreviewDto::Text {
                text: String::from_utf8_lossy(&bytes).into_owned(),
                truncated: attachment.size > MAX_TEXT_BYTES,
            })
        }
        PreviewKind::Markdown => {
            let text = read_document_text(context, &attachment.id, attachment.size)?;
            let blocks =
                import_markdown::parse_markdown_preview(context, Path::new("preview.md"), &text)?;
            Ok(blocks_preview("markdown", blocks))
        }
        PreviewKind::Word => {
            let extension = Path::new(&attachment.name)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let bytes = read_document_bytes(context, &attachment.id, attachment.size)?;
            let blocks = parse_word_bytes(context, &attachment.id, &extension, bytes)?;
            Ok(blocks_preview("docx", blocks))
        }
    }
}

/// 一次预转换任务。
struct PrecomputeJob {
    context: AttachmentContext,
    attachment: AttachmentDto,
}

/// 预转换队列：进程内单工作线程，队列有界。
static PRECOMPUTE_QUEUE: OnceLock<Option<SyncSender<PrecomputeJob>>> = OnceLock::new();

fn spawn_worker() -> Option<SyncSender<PrecomputeJob>> {
    let (sender, receiver) = mpsc::sync_channel::<PrecomputeJob>(PRECOMPUTE_QUEUE_CAPACITY);
    let spawned = thread::Builder::new()
        .name("attachment-preview".to_string())
        .spawn(move || {
            while let Ok(job) = receiver.recv() {
                match compute_preview(&job.context, &job.attachment) {
                    Ok(dto) => store_cached(&job.context, &job.attachment, &dto),
                    Err(error) => logging::debug(
                        "attachment.preview",
                        &format!("预转换失败 id={}: {error}", job.attachment.id),
                    ),
                }
            }
        });
    match spawned {
        Ok(_) => Some(sender),
        Err(error) => {
            logging::error("attachment.preview", &format!("启动预览线程失败: {error}"));
            None
        }
    }
}

/// 写入时预转换：附件落库后立刻排队生成预览并入库，打开时直接取现成结果。
///
/// 图片与不支持预览的类型直接跳过——它们的「预览」就是读字节，预转换没有意义。
pub fn schedule_precompute(context: AttachmentContext, attachment: AttachmentDto) {
    if matches!(
        preview_kind(&attachment),
        PreviewKind::Image | PreviewKind::None
    ) {
        return;
    }
    let Some(sender) = PRECOMPUTE_QUEUE.get_or_init(spawn_worker).as_ref() else {
        return;
    };
    match sender.try_send(PrecomputeJob {
        context,
        attachment,
    }) {
        Ok(()) => {}
        Err(TrySendError::Full(job)) => logging::debug(
            "attachment.preview",
            &format!("预览队列已满，跳过预转换 id={}", job.attachment.id),
        ),
        Err(TrySendError::Disconnected(job)) => logging::error(
            "attachment.preview",
            &format!("预览线程已退出，跳过预转换 id={}", job.attachment.id),
        ),
    }
}

fn blocks_preview(format: &str, mut blocks: Vec<Value>) -> AttachmentPreviewDto {
    let truncated = blocks.len() > MAX_PREVIEW_BLOCKS;
    if truncated {
        blocks.truncate(MAX_PREVIEW_BLOCKS);
    }
    AttachmentPreviewDto::Blocks {
        format: format.to_string(),
        blocks,
        truncated,
    }
}

/// 按附件 id 读出对象字节，最多读 `max_bytes`（用于纯文本截断读取）。
fn read_object(
    context: &AttachmentContext,
    attachment_id: &str,
    max_bytes: i64,
) -> AppResult<Vec<u8>> {
    let connection = context.connection()?;
    let attachment = repository::find_active(&connection, attachment_id)?
        .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
    let blob = repository::find_blob(&connection, &attachment.content_hash)?
        .ok_or_else(|| AppError::not_found("附件内容不存在"))?;
    let mut bytes: Vec<u8> = Vec::new();
    attachment_store::read_blob(&blob, &context.storage_root, |chunk| {
        let room = max_bytes.saturating_sub(bytes.len() as i64) as usize;
        if room > 0 {
            bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        }
        Ok(())
    })?;
    Ok(bytes)
}

/// 文本类文档（Markdown）需要整份内容，超过上限直接拒绝并给出可读原因。
fn read_document_text(
    context: &AttachmentContext,
    attachment_id: &str,
    size: i64,
) -> AppResult<String> {
    let bytes = read_document_bytes(context, attachment_id, size)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_document_bytes(
    context: &AttachmentContext,
    attachment_id: &str,
    size: i64,
) -> AppResult<Vec<u8>> {
    if size > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation(
            "文件过大，暂不支持在应用内预览，请下载后查看",
        ));
    }
    read_object(context, attachment_id, MAX_DOCUMENT_BYTES)
}

/// Word 解析需要真实文件路径：把对象字节落到暂存目录，解析后立即删除。
fn parse_word_bytes(
    context: &AttachmentContext,
    attachment_id: &str,
    extension: &str,
    bytes: Vec<u8>,
) -> AppResult<Vec<Value>> {
    let temp_dir = context.storage_root.join(TEMP_DIR_RELATIVE);
    std::fs::create_dir_all(&temp_dir)?;
    let file_name = format!("preview-{attachment_id}.{extension}");
    let temp_path = temp_dir.join(file_name);
    std::fs::write(&temp_path, &bytes)?;
    let result = import_word::parse_word_preview(context, &temp_path);
    // 预览失败也要把临时文件删掉，避免占用「临时文件」统计。
    let _ = std::fs::remove_file(&temp_path);
    result
}
