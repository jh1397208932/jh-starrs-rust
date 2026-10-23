//! 附件存储 IPC 适配层。
//!
//! 大文件相关命令通过 `spawn_blocking` 执行，避免哈希/复制阻塞 Tauri 主线程；
//! 命令只做参数转发，不承载业务规则。

use tauri::State;

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentDeleteResult, AttachmentDto, AttachmentListQuery, AttachmentStatsDto,
    AttachmentVerifyResult, DownloadAttachmentInput, DownloadAttachmentResult,
    UpdateAttachmentInput, UploadAttachmentInput,
};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::state::AppState;

/// 上传本地文件到当前工作区附件库。
#[tauri::command(async)]
pub async fn attachment_upload(
    state: State<'_, AppState>,
    input: UploadAttachmentInput,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::upload(&context, input)).await
}

/// 列出附件；可包含软删除行。
#[tauri::command(async)]
pub fn attachment_list(
    state: State<'_, AppState>,
    query: AttachmentListQuery,
) -> AppResult<Vec<AttachmentDto>> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::list(&context, &query)
}

/// 读取单条活跃附件。
#[tauri::command(async)]
pub fn attachment_get(state: State<'_, AppState>, id: String) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::get(&context, &id)
}

/// 重命名或移动逻辑附件。
#[tauri::command(async)]
pub fn attachment_update(
    state: State<'_, AppState>,
    input: UpdateAttachmentInput,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::update(&context, input)
}

/// 软删除附件；物理删除/压缩在服务层异步处理。
#[tauri::command(async)]
pub async fn attachment_delete(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<AttachmentDeleteResult> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::delete(&context, &id)).await
}

/// 流式导出附件到用户选择的目标路径。
#[tauri::command(async)]
pub async fn attachment_download(
    state: State<'_, AppState>,
    input: DownloadAttachmentInput,
) -> AppResult<DownloadAttachmentResult> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::download(&context, input)).await
}

/// 流式校验附件内容与元数据是否一致。
#[tauri::command(async)]
pub async fn attachment_verify(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<AttachmentVerifyResult> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::verify(&context, &id)).await
}

/// 附件与物理对象统计。
#[tauri::command(async)]
pub fn attachment_stats(state: State<'_, AppState>) -> AppResult<AttachmentStatsDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::stats(&context)
}

async fn run_blocking<T: Send + 'static>(
    job: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    match tauri::async_runtime::spawn_blocking(job).await {
        Ok(result) => result,
        Err(error) => {
            logging::error("attachment", &format!("附件后台任务异常: {error}"));
            Err(AppError::Internal)
        }
    }
}

/// 上传来自剪贴板/拖放的原始字节（raw IPC body + hex 头元数据）。
#[tauri::command(async)]
pub async fn attachment_upload_bytes(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    let name = decode_hex_header(&request, "x-file-name-hex")?
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::validation("缺少上传文件名"))?;
    let logical_path = decode_hex_header(&request, "x-logical-path-hex")?.unwrap_or_default();
    let mime = header_value(&request, "x-file-mime").filter(|value| !value.is_empty());
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err(AppError::validation("上传请求必须是原始字节")),
    };
    run_blocking(move || {
        attachment_service::upload_bytes(&context, name, logical_path, mime, bytes)
    })
    .await
}

/// 读取图片附件原始字节，供编辑器生成 Blob URL 预览。
#[tauri::command(async)]
pub async fn attachment_read_bytes(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<tauri::ipc::Response> {
    let context = AttachmentContext::from_state(state.inner())?;
    let bytes = run_blocking(move || attachment_service::read_bytes(&context, &id)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn header_value(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn decode_hex_header(request: &tauri::ipc::Request<'_>, name: &str) -> AppResult<Option<String>> {
    let Some(value) = header_value(request, name) else {
        return Ok(None);
    };
    let bytes = decode_hex(&value)?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| AppError::validation("上传元数据不是合法 UTF-8"))
}

fn decode_hex(value: &str) -> AppResult<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return Err(AppError::validation("上传元数据编码无效"));
    }
    let mut bytes = Vec::with_capacity(value.len() / 2);
    let raw = value.as_bytes();
    for index in (0..raw.len()).step_by(2) {
        let high = hex_digit(raw[index])?;
        let low = hex_digit(raw[index + 1])?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

fn hex_digit(value: u8) -> AppResult<u8> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(AppError::validation("上传元数据编码无效")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_hex_file_name() {
        let name = "演示图片.png";
        let encoded: String = name
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(decode_hex(&encoded).expect("hex 解码"), name.as_bytes());
    }

    #[test]
    fn rejects_invalid_hex_metadata() {
        assert!(decode_hex("abc").is_err());
        assert!(decode_hex("zz").is_err());
        assert!(decode_hex("").expect("空路径合法").is_empty());
    }
}
