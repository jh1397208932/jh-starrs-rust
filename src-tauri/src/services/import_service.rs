//! 导入用例：Markdown / Word 单文件与目录批量导入。
//!
//! 每个文件先创建文档节点，再解析正文；解析失败也会保留原始文件并写入说明，
//! 避免“导入失败但原文件也找不到”。目录导入可把相对目录创建为文件夹节点。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Map, Value, json};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{AttachmentDto, AttachmentListQuery, UploadAttachmentInput};
use crate::models::board::BoardSaveInput;
use crate::models::document::SaveDocumentInput;
use crate::models::exchange::{ImportDocumentsInput, ImportFileResult, ImportMode, ImportResult};
use crate::models::{CreateNodeInput, NodeDto};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::import_markdown::parse_markdown;
use crate::services::import_word::parse_word;
use crate::services::{board_service, document_service, knowledge_base_service, node_service};
use crate::state::AppState;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const WORD_EXTENSIONS: &[&str] = &["docx", "docm", "dotx", "dotm", "doc"];
const EXCALIDRAW_EXTENSIONS: &[&str] = &["excalidraw"];

struct ParsedContent {
    blocks: Vec<Value>,
    warnings: Vec<String>,
    attachment_count: usize,
}

/// 批量导入入口。
pub fn import_documents(state: &AppState, input: ImportDocumentsInput) -> AppResult<ImportResult> {
    let kb = knowledge_base_service::get(state, &input.knowledge_base_id)?;
    let parent_id = input.parent_id.clone();
    if let Some(parent_id) = &parent_id {
        let parent = node_service::get(state, parent_id)?;
        if parent.knowledge_base_id != kb.id {
            return Err(AppError::validation("目标文件夹不可用"));
        }
        if parent.node_type != 1 {
            return Err(AppError::validation("请选择文件夹"));
        }
    }
    if input.paths.is_empty() {
        return Err(AppError::validation("请选择要导入的文件或文件夹"));
    }
    let attachment = AttachmentContext::from_state(state)?;
    let mut result = ImportResult::default();

    for raw in &input.paths {
        let path = PathBuf::from(raw);
        if !path.is_absolute() {
            result.files.push(ImportFileResult {
                source_path: raw.clone(),
                node_id: None,
                title: String::new(),
                ok: false,
                message: Some("路径必须是绝对路径".to_string()),
                warnings: Vec::new(),
                attachment_count: 0,
            });
            result.failed += 1;
            continue;
        }
        if path.is_dir() {
            if input.mode != ImportMode::Directory {
                result.files.push(ImportFileResult {
                    source_path: raw.clone(),
                    node_id: None,
                    title: String::new(),
                    ok: false,
                    message: Some("文件导入模式不接受文件夹".to_string()),
                    warnings: Vec::new(),
                    attachment_count: 0,
                });
                result.failed += 1;
                continue;
            }
            import_directory(
                state,
                &attachment,
                &kb.id,
                parent_id.as_deref(),
                &path,
                input.preserve_hierarchy,
                &mut result,
            )?;
        } else if path.is_file() {
            let outcome = import_file(state, &attachment, &kb.id, parent_id.as_deref(), &path)?;
            if outcome.ok {
                result.imported += 1;
            } else {
                result.failed += 1;
            }
            result.files.push(outcome);
        } else {
            result.files.push(ImportFileResult {
                source_path: raw.clone(),
                node_id: None,
                title: String::new(),
                ok: false,
                message: Some("文件不存在".to_string()),
                warnings: Vec::new(),
                attachment_count: 0,
            });
            result.failed += 1;
        }
    }
    logging::info(
        "import",
        &format!(
            "导入完成 kb={} imported={} failed={} folders={}",
            kb.id,
            result.imported,
            result.failed,
            result.created_folder_ids.len()
        ),
    );
    Ok(result)
}

fn import_directory(
    state: &AppState,
    attachment: &AttachmentContext,
    kb_id: &str,
    parent_id: Option<&str>,
    root: &Path,
    preserve_hierarchy: bool,
    result: &mut ImportResult,
) -> AppResult<()> {
    let parent = if preserve_hierarchy {
        let title = root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("导入目录");
        let folder = create_folder(state, kb_id, parent_id, title)?;
        result.created_folder_ids.push(folder.id.clone());
        Some(folder.id)
    } else {
        parent_id.map(str::to_string)
    };
    walk_directory(
        state,
        attachment,
        kb_id,
        parent.as_deref(),
        root,
        preserve_hierarchy,
        result,
    )
}

fn walk_directory(
    state: &AppState,
    attachment: &AttachmentContext,
    kb_id: &str,
    parent_id: Option<&str>,
    dir: &Path,
    preserve_hierarchy: bool,
    result: &mut ImportResult,
) -> AppResult<()> {
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                result
                    .files
                    .push(failure(&path, format!("读取失败：{error}")));
                result.failed += 1;
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if preserve_hierarchy {
                let title = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("文件夹");
                let folder = create_folder(state, kb_id, parent_id, title)?;
                result.created_folder_ids.push(folder.id.clone());
                walk_directory(
                    state,
                    attachment,
                    kb_id,
                    Some(&folder.id),
                    &path,
                    preserve_hierarchy,
                    result,
                )?;
            } else {
                walk_directory(
                    state,
                    attachment,
                    kb_id,
                    parent_id,
                    &path,
                    preserve_hierarchy,
                    result,
                )?;
            }
        } else if is_supported(&path) {
            let outcome = import_file(state, attachment, kb_id, parent_id, &path)?;
            if outcome.ok {
                result.imported += 1;
            } else {
                result.failed += 1;
            }
            result.files.push(outcome);
        }
    }
    Ok(())
}

/// 导入 `.excalidraw`：创建画板节点，上传内嵌图片并恢复 Starris 附件映射。
fn import_excalidraw_file(
    state: &AppState,
    attachment: &AttachmentContext,
    kb_id: &str,
    parent_id: Option<&str>,
    path: &Path,
) -> AppResult<ImportFileResult> {
    let source_path = path.to_string_lossy().into_owned();
    let raw = fs::read_to_string(path).map_err(|error| {
        logging::error(
            "import",
            &format!("读取 Excalidraw 失败 path={} error={error}", path.display()),
        );
        AppError::validation("画板文件无法读取")
    })?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| {
        logging::error(
            "import",
            &format!(
                "Excalidraw JSON 解析失败 path={} error={error}",
                path.display()
            ),
        );
        AppError::validation("画板文件无效")
    })?;
    let Some(mut elements) = value.get("elements").and_then(Value::as_array).cloned() else {
        return Ok(failure(
            path,
            "Excalidraw 文件缺少 elements 数组".to_string(),
        ));
    };

    let mut warnings = Vec::new();
    let app_state = match value.get("appState") {
        Some(state) if state.is_object() => state.clone(),
        Some(_) => {
            warnings.push("appState 不是对象，已按空设置导入".to_string());
            json!({})
        }
        None => json!({}),
    };
    let files = value
        .get("files")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let desired_title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("导入画板")
        .to_string();
    let title = unique_title(state, kb_id, parent_id, &desired_title)?;
    let node = node_service::create(
        state,
        CreateNodeInput {
            knowledge_base_id: kb_id.to_string(),
            parent_id: parent_id.map(str::to_string),
            node_type: 3,
            title: title.clone(),
        },
    )?;

    let mut attachment_count = 0usize;
    upload_board_images(
        attachment,
        &mut elements,
        &files,
        &mut warnings,
        &mut attachment_count,
    );
    let sidecar = load_board_sidecar(path, &mut warnings);
    restore_file_card_attachments(
        attachment,
        &mut elements,
        &sidecar,
        &mut warnings,
        &mut attachment_count,
    );

    let saved = board_service::save(
        state,
        BoardSaveInput {
            node_id: node.id.clone(),
            base_version: 0,
            elements: Value::Array(elements),
            app_state,
        },
    );
    if let Err(error) = saved {
        let _ = node_service::delete(state, &node.id);
        return Ok(ImportFileResult {
            source_path,
            node_id: None,
            title,
            ok: false,
            message: Some(format!("保存画板失败：{error}")),
            warnings,
            attachment_count,
        });
    }

    logging::info(
        "import",
        &format!(
            "导入 Excalidraw 画板 node={} attachments={} warnings={}",
            node.id,
            attachment_count,
            warnings.len()
        ),
    );
    Ok(ImportFileResult {
        source_path,
        node_id: Some(node.id),
        title,
        ok: true,
        message: None,
        warnings,
        attachment_count,
    })
}

/// 上传 `files` 中的图片 dataURL，并把 image 图元的 fileId 改写为 object_id。
fn upload_board_images(
    context: &AttachmentContext,
    elements: &mut [Value],
    files: &Map<String, Value>,
    warnings: &mut Vec<String>,
    attachment_count: &mut usize,
) {
    for element in elements.iter_mut() {
        if element.get("type").and_then(Value::as_str) != Some("image") {
            continue;
        }
        let Some(file_id) = element
            .get("fileId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
        else {
            continue;
        };
        let Some(file) = files.get(&file_id) else {
            warnings.push(format!("图片 {file_id} 缺少内嵌文件，已保留原引用"));
            continue;
        };
        let Some(data_url) = file.get("dataURL").and_then(Value::as_str) else {
            warnings.push(format!("图片 {file_id} 缺少 dataURL，已保留原引用"));
            continue;
        };
        let Some((data_mime, bytes)) = decode_data_url(data_url) else {
            warnings.push(format!("图片 {file_id} 的 dataURL 无法解析，已保留原引用"));
            continue;
        };
        let mime = if data_mime.is_empty() {
            file.get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or("image/png")
                .to_string()
        } else {
            data_mime
        };
        if !mime.starts_with("image/") {
            warnings.push(format!("图片 {file_id} 的 MIME「{mime}」不是图片，已跳过"));
            continue;
        }
        let name = format!(
            "画板图片-{}.{}",
            &crate::utils::new_id()[..8],
            image_extension(&mime)
        );
        match attachment_service::upload_bytes(context, name, "画板".to_string(), Some(mime), bytes)
        {
            Ok(uploaded) => {
                if let Some(object) = element.as_object_mut() {
                    object.insert("fileId".to_string(), Value::String(uploaded.id));
                    let custom = object
                        .entry("customData".to_string())
                        .or_insert_with(|| json!({}));
                    if let Some(custom) = custom.as_object_mut() {
                        custom.insert("boardObject".to_string(), Value::Bool(true));
                    }
                }
                *attachment_count += 1;
            }
            Err(error) => warnings.push(format!("图片 {file_id} 上传失败：{error}")),
        }
    }
}

/// 解析 `data:<mime>;base64,<payload>`。
fn decode_data_url(data_url: &str) -> Option<(String, Vec<u8>)> {
    let rest = data_url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mut parts = meta.split(';');
    let mime = parts.next().unwrap_or_default().trim().to_string();
    if !parts.any(|part| part.eq_ignore_ascii_case("base64")) {
        return None;
    }
    let bytes = BASE64.decode(payload.trim()).ok()?;
    Some((mime, bytes))
}

fn image_extension(mime: &str) -> String {
    let subtype = mime
        .split('/')
        .nth(1)
        .unwrap_or("bin")
        .split('+')
        .next()
        .unwrap_or("bin");
    let cleaned: String = subtype
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();
    match cleaned.as_str() {
        "" => "bin".to_string(),
        "jpeg" => "jpg".to_string(),
        other => other.to_string(),
    }
}

struct BoardSidecarEntry {
    name: String,
    mime: String,
    path: PathBuf,
}

/// 读取画板目录中的 `attachments.json`；不可读时只记录警告。
fn load_board_sidecar(
    source: &Path,
    warnings: &mut Vec<String>,
) -> HashMap<String, BoardSidecarEntry> {
    let Some(parent) = source.parent() else {
        return HashMap::new();
    };
    let sidecar_path = parent.join("attachments.json");
    if !sidecar_path.is_file() {
        return HashMap::new();
    }
    let raw = match fs::read_to_string(&sidecar_path) {
        Ok(raw) => raw,
        Err(error) => {
            warnings.push(format!("attachments.json 读取失败：{error}"));
            return HashMap::new();
        }
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(error) => {
            warnings.push(format!("attachments.json 解析失败：{error}"));
            return HashMap::new();
        }
    };
    let Some(entries) = value.get("attachments").and_then(Value::as_array) else {
        return HashMap::new();
    };
    let mut result = HashMap::new();
    for entry in entries {
        let Some(object_id) = entry.get("objectId").and_then(Value::as_str) else {
            continue;
        };
        let Some(relative) = entry.get("file").and_then(Value::as_str) else {
            continue;
        };
        let Some(path) = resolve_sidecar_file(parent, relative) else {
            warnings.push(format!("attachments.json 中的路径不安全：「{relative}」"));
            continue;
        };
        if !path.is_file() {
            warnings.push(format!("画板附件「{relative}」不存在，已跳过"));
            continue;
        }
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("画板附件")
                    .to_string()
            });
        let mime = entry
            .get("mime")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        result.insert(
            object_id.to_string(),
            BoardSidecarEntry { name, mime, path },
        );
    }
    result
}

fn resolve_sidecar_file(parent: &Path, raw: &str) -> Option<PathBuf> {
    let relative = Path::new(raw);
    if relative.is_absolute() {
        return None;
    }
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(parent.join(relative))
}

/// 把文件卡片里的 objectId 映射到 sidecar 文件，重新上传并改写。
fn restore_file_card_attachments(
    context: &AttachmentContext,
    elements: &mut [Value],
    sidecar: &HashMap<String, BoardSidecarEntry>,
    warnings: &mut Vec<String>,
    attachment_count: &mut usize,
) {
    if sidecar.is_empty() {
        return;
    }
    for element in elements.iter_mut() {
        let object_id = element
            .get("customData")
            .and_then(Value::as_object)
            .and_then(|custom| custom.get("objectId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let Some(object_id) = object_id else {
            continue;
        };
        let is_card = element
            .get("customData")
            .and_then(Value::as_object)
            .and_then(|custom| custom.get("boardFileCard"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !is_card {
            continue;
        }
        let Some(entry) = sidecar.get(&object_id) else {
            warnings.push(format!("文件卡片附件 {object_id} 缺少 sidecar 映射"));
            continue;
        };
        let bytes = match fs::read(&entry.path) {
            Ok(bytes) => bytes,
            Err(error) => {
                warnings.push(format!("画板附件「{}」读取失败：{error}", entry.name));
                continue;
            }
        };
        let mime = if entry.mime.trim().is_empty() {
            None
        } else {
            Some(entry.mime.clone())
        };
        match attachment_service::upload_bytes(
            context,
            entry.name.clone(),
            "画板".to_string(),
            mime,
            bytes,
        ) {
            Ok(uploaded) => {
                if let Some(custom) = element.get_mut("customData").and_then(Value::as_object_mut) {
                    custom.insert("objectId".to_string(), Value::String(uploaded.id));
                }
                *attachment_count += 1;
            }
            Err(error) => warnings.push(format!("画板附件「{}」上传失败：{error}", entry.name)),
        }
    }
}

fn import_file(
    state: &AppState,
    attachment: &AttachmentContext,
    kb_id: &str,
    parent_id: Option<&str>,
    path: &Path,
) -> AppResult<ImportFileResult> {
    if EXCALIDRAW_EXTENSIONS.contains(&extension(path).as_str()) {
        return import_excalidraw_file(state, attachment, kb_id, parent_id, path);
    }
    if !is_supported(path) {
        return Ok(failure(
            path,
            "不支持的文件格式（仅支持 Markdown、Word 与 Excalidraw 画板）".to_string(),
        ));
    }
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("导入文档")
        .to_string();
    let title = unique_title(state, kb_id, parent_id, &title)?;
    let node = node_service::create(
        state,
        CreateNodeInput {
            knowledge_base_id: kb_id.to_string(),
            parent_id: parent_id.map(str::to_string),
            node_type: 2,
            title: title.clone(),
        },
    )?;

    let asset_prefix = {
        let raw = path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("asset")
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric())
            .take(16)
            .collect::<String>();
        let stem = if raw.is_empty() {
            "asset".to_string()
        } else {
            raw
        };
        format!("{stem}-{}", &crate::utils::new_id()[..8])
    };
    let parsed = match parse_content(attachment, path, &asset_prefix) {
        Ok(parsed) => parsed,
        Err(error) => {
            logging::error(
                "import",
                &format!("解析正文失败 path={} error={error}", path.display()),
            );
            ParsedContent {
                blocks: vec![json!({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "正文自动转换失败，原始文件已作为附件保留。"}],
                })],
                warnings: vec![format!("正文解析失败：{error}")],
                attachment_count: 0,
            }
        }
    };

    let mut warnings = parsed.warnings;
    let mut attachment_count = parsed.attachment_count;
    let mut blocks = parsed.blocks;
    match upload_original(attachment, path) {
        Ok(original) => {
            attachment_count += 1;
            blocks.push(json!({
                "type": "attachmentBlock",
                "attrs": {
                    "variant": "list",
                    "align": "left",
                    "items": [{
                        "attachmentId": original.id,
                        "name": original.name,
                        "size": original.size,
                        "mime": original.mime,
                    }],
                },
            }));
        }
        Err(error) => warnings.push(format!("原始文件附加失败：{error}")),
    }

    let document = json!({"type": "doc", "content": blocks});
    if let Err(error) = document_service::save(
        state,
        SaveDocumentInput {
            node_id: node.id.clone(),
            document,
        },
    ) {
        let _ = node_service::delete(state, &node.id);
        return Ok(ImportFileResult {
            source_path: path.to_string_lossy().into_owned(),
            node_id: None,
            title,
            ok: false,
            message: Some(format!("保存文档失败：{error}")),
            warnings,
            attachment_count,
        });
    }

    Ok(ImportFileResult {
        source_path: path.to_string_lossy().into_owned(),
        node_id: Some(node.id),
        title,
        ok: true,
        message: None,
        warnings,
        attachment_count,
    })
}

fn parse_content(
    attachment: &AttachmentContext,
    path: &Path,
    asset_prefix: &str,
) -> AppResult<ParsedContent> {
    let extension = extension(path);
    if MARKDOWN_EXTENSIONS.contains(&extension.as_str()) {
        let text = fs::read_to_string(path).map_err(|error| {
            logging::error("import", &format!("读取 Markdown 失败: {error}"));
            AppError::validation("Markdown 文件无法读取")
        })?;
        let parsed = parse_markdown(attachment, path, &text, asset_prefix)?;
        return Ok(ParsedContent {
            blocks: parsed.blocks,
            warnings: parsed.warnings,
            attachment_count: parsed.attachment_count,
        });
    }
    if WORD_EXTENSIONS.contains(&extension.as_str()) {
        let parsed = parse_word(attachment, path, asset_prefix)?;
        return Ok(ParsedContent {
            blocks: parsed.blocks,
            warnings: parsed.warnings,
            attachment_count: parsed.attachment_count,
        });
    }
    Err(AppError::validation("不支持的文件格式"))
}

fn upload_original(attachment: &AttachmentContext, path: &Path) -> AppResult<AttachmentDto> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("原始文件");
    attachment_service::upload(
        attachment,
        UploadAttachmentInput {
            source_path: path.to_string_lossy().into_owned(),
            logical_path: "attach".to_string(),
            name: Some(unique_attachment_name(attachment, name)),
            mime: None,
            scope: Some("node".to_string()),
            ttl_seconds: None,
        },
    )
}

fn unique_attachment_name(context: &AttachmentContext, desired: &str) -> String {
    let Ok(existing) = attachment_service::list(
        context,
        &AttachmentListQuery {
            logical_path: Some("attach".to_string()),
            include_deleted: false,
        },
    ) else {
        return desired.to_string();
    };
    let used = existing
        .iter()
        .map(|item| item.name.as_str())
        .collect::<HashSet<_>>();
    if !used.contains(desired) {
        return desired.to_string();
    }
    let path = Path::new(desired);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(desired);
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2..10_000 {
        let candidate = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        if !used.contains(candidate.as_str()) {
            return candidate;
        }
    }
    format!("{desired}-{}", crate::utils::now_ms())
}

fn create_folder(
    state: &AppState,
    kb_id: &str,
    parent_id: Option<&str>,
    title: &str,
) -> AppResult<NodeDto> {
    let title = unique_title(state, kb_id, parent_id, title)?;
    node_service::create(
        state,
        CreateNodeInput {
            knowledge_base_id: kb_id.to_string(),
            parent_id: parent_id.map(str::to_string),
            node_type: 1,
            title,
        },
    )
}

fn unique_title(
    state: &AppState,
    kb_id: &str,
    parent_id: Option<&str>,
    desired: &str,
) -> AppResult<String> {
    let nodes = node_service::list(state, kb_id)?;
    let used = nodes
        .iter()
        .filter(|node| node.parent_id.as_deref() == parent_id)
        .map(|node| node.title.clone())
        .collect::<HashSet<_>>();
    if !used.contains(desired) {
        return Ok(desired.to_string());
    }
    for index in 2..10_000 {
        let candidate = format!("{desired} ({index})");
        if !used.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Ok(format!("{desired}-{}", crate::utils::now_ms()))
}

fn failure(path: &Path, message: String) -> ImportFileResult {
    ImportFileResult {
        source_path: path.to_string_lossy().into_owned(),
        node_id: None,
        title: path
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
        ok: false,
        message: Some(message),
        warnings: Vec::new(),
        attachment_count: 0,
    }
}

fn is_supported(path: &Path) -> bool {
    let extension = extension(path);
    MARKDOWN_EXTENSIONS.contains(&extension.as_str())
        || WORD_EXTENSIONS.contains(&extension.as_str())
        || EXCALIDRAW_EXTENSIONS.contains(&extension.as_str())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}
