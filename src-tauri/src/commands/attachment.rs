//! 附件存储 IPC 适配层。
//!
//! 大文件相关命令通过 `spawn_blocking` 执行，避免哈希/复制阻塞 Tauri 主线程；
//! 命令只做参数转发，不承载业务规则。

use tauri::{Manager, State};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{
    AttachmentDeleteResult, AttachmentDto, AttachmentLifecycleInput, AttachmentListQuery,
    AttachmentMaintenanceResult, AttachmentStatsDto, AttachmentVerifyResult,
    DownloadAttachmentInput, DownloadAttachmentResult, MaintenanceSettingsDto,
    MaintenanceSettingsInput, UpdateAttachmentInput, UploadAttachmentInput,
    UploadAttachmentNodeInput, WorkspaceStorageStatsDto,
};
use crate::models::{FolderImportInput, NodeDto};
use crate::services::attachment_maintenance_service;
use crate::services::attachment_preview_service;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::attachment_tree_import_service;
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

/// 从文件树上传附件并创建 type=6 节点；两步失败时回滚逻辑附件。
///
/// 与「上传文件夹」共用同一份实现（`upload_file_as_node`），保证回滚规则只有一处。
#[tauri::command(async)]
pub async fn attachment_upload_to_tree(
    app: tauri::AppHandle,
    input: UploadAttachmentNodeInput,
) -> AppResult<NodeDto> {
    let kb_id = input.knowledge_base_id;
    let parent_id = input.parent_id;
    let source = std::path::PathBuf::from(&input.source_path);
    let logical_path = input.logical_path;
    let name = input.name;
    let mime = input.mime;
    run_blocking(move || {
        let state = app.state::<AppState>();
        attachment_tree_import_service::upload_file_as_node(
            state.inner(),
            &kb_id,
            parent_id.as_deref(),
            &source,
            &logical_path,
            name.as_deref(),
            mime,
        )
    })
    .await
}

/// 上传整个文件夹：按目录层级创建文件夹节点并递归上传其中的文件。
#[tauri::command(async)]
pub async fn attachment_upload_folder(
    app: tauri::AppHandle,
    input: FolderImportInput,
) -> AppResult<attachment_tree_import_service::FolderImportResult> {
    let kb_id = input.knowledge_base_id;
    let parent_id = input.parent_id;
    let folder = std::path::PathBuf::from(&input.folder_path);
    run_blocking(move || {
        let state = app.state::<AppState>();
        attachment_tree_import_service::import_folder(
            state.inner(),
            &kb_id,
            parent_id.as_deref(),
            &folder,
        )
    })
    .await
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

/// 按附件节点读取对象。
#[tauri::command(async)]
pub fn attachment_get_by_node(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::get_by_node(&context, &node_id)
}

/// 读取附件预览：纯文本 / Markdown / Word 返回内容或块 JSON；图片与其它类型返回不支持。
#[tauri::command(async)]
pub async fn attachment_preview(
    state: State<'_, AppState>,
    node_id: String,
) -> AppResult<attachment_preview_service::AttachmentPreviewDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_preview_service::preview(&context, &node_id)).await
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

/// 当前工作区的分类磁盘占用（数据库/附件/回收站/暂存/隔离区），供 Settings 存储页展示。
#[tauri::command(async)]
pub async fn workspace_storage_stats(
    state: State<'_, AppState>,
) -> AppResult<WorkspaceStorageStatsDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::workspace_storage_stats(&context)).await
}

/// 从回收站恢复附件。
#[tauri::command(async)]
pub async fn attachment_restore(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    run_blocking(move || attachment_service::restore(&context, &id)).await
}

/// 设置未关联附件的临时保留时间。
#[tauri::command(async)]
pub fn attachment_set_lifecycle(
    state: State<'_, AppState>,
    input: AttachmentLifecycleInput,
) -> AppResult<AttachmentDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_service::set_lifecycle(&context, input)
}

/// 立即执行一轮附件维护（设置 → 存储「立即清理」）。
///
/// 走 `run_manual`：只回收无用数据，不重写仍在使用对象的 pack 文件。
#[tauri::command(async)]
pub async fn attachment_maintenance(
    state: State<'_, AppState>,
) -> AppResult<AttachmentMaintenanceResult> {
    let context = AttachmentContext::from_state(state.inner())?;
    let policy = attachment_maintenance_service::load_policy(&context)?;
    run_blocking(move || {
        attachment_maintenance_service::run_manual(&context, crate::utils::now_ms(), policy)
    })
    .await
}

/// 读取当前工作区的附件保留策略。
#[tauri::command(async)]
pub fn attachment_maintenance_settings(
    state: State<'_, AppState>,
) -> AppResult<MaintenanceSettingsDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_maintenance_service::settings(&context)
}

/// 保存当前工作区的附件保留策略。
#[tauri::command(async)]
pub fn attachment_update_maintenance_settings(
    state: State<'_, AppState>,
    input: MaintenanceSettingsInput,
) -> AppResult<MaintenanceSettingsDto> {
    let context = AttachmentContext::from_state(state.inner())?;
    attachment_maintenance_service::update_settings(&context, input)
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
