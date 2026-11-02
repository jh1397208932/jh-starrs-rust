//! 导入用例：Markdown / Word 单文件与目录批量导入。
//!
//! 每个文件先创建文档节点，再解析正文；解析失败也会保留原始文件并写入说明，
//! 避免“导入失败但原文件也找不到”。目录导入可把相对目录创建为文件夹节点。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde_json::{Map, Value, json};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{AttachmentDto, SCOPE_NODE, UploadAttachmentInput};
use crate::models::board::BoardSaveInput;
use crate::models::document::SaveDocumentInput;
use crate::models::exchange::{
    ImportDocumentsInput, ImportFileResult, ImportMode, ImportResult, ImportScanResult,
    ImportScanSkippedFile,
};
use crate::models::{CreateAttachmentNodeInput, CreateNodeInput, NodeDto};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::import_markdown::parse_markdown;
use crate::services::import_pdf::parse_pdf;
use crate::services::import_word::parse_word;
use crate::services::{board_service, document_service, knowledge_base_service, node_service};
use crate::state::AppState;

const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd"];
const WORD_EXTENSIONS: &[&str] = &["docx", "docm", "dotx", "dotm", "doc"];
const PDF_EXTENSIONS: &[&str] = &["pdf"];
/// 混合导入扫描上限：防止损坏或超深目录拖垮预扫描。
const MAX_SCAN_FILES: usize = 50_000;
const MAX_SCAN_DEPTH: usize = 32;
/// Markdown/文本导入上限：整份读入内存再转块 JSON，超过后内存与耗时都不可控。
const MAX_TEXT_IMPORT_BYTES: u64 = 32 * 1024 * 1024;
/// Word 导入上限；与 PDF（128 MiB）对齐。
const MAX_WORD_IMPORT_BYTES: u64 = 128 * 1024 * 1024;
/// 一次最多回传的跳过项；计数仍以真实总数为准。
const MAX_SCAN_REPORTED: usize = 500;
/// 整库导出的清单文件：导入器自己读，不算用户内容。
const IMPORT_METADATA_FILES: &[&str] = &["manifest.json"];
const EXCALIDRAW_EXTENSIONS: &[&str] = &["excalidraw"];
/// Starris 整库导出的清单文件名；存在时可恢复附件节点。
const MANIFEST_FILE: &str = "manifest.json";

struct ParsedContent {
    blocks: Vec<Value>,
    warnings: Vec<String>,
    attachment_count: usize,
}

/// 整库导出 manifest 中的附件节点。
struct AttachmentManifestEntry {
    title: String,
    path: PathBuf,
    relative: Option<PathBuf>,
    mime: Option<String>,
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

/// 目录导入期间共享的上下文，避免把 9 个参数逐个传递归函数。
struct ImportWalkContext<'a> {
    state: &'a AppState,
    attachment: &'a AttachmentContext,
    kb_id: &'a str,
    preserve_hierarchy: bool,
    attachment_paths: &'a HashSet<PathBuf>,
    folders: &'a mut HashMap<PathBuf, String>,
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
    let manifest = read_attachment_manifest(root);
    let attachment_paths: HashSet<PathBuf> = manifest
        .iter()
        .filter_map(|entry| entry.relative.clone())
        .collect();
    let mut folders: HashMap<PathBuf, String> = HashMap::new();
    if let Some(id) = parent.as_ref() {
        folders.insert(PathBuf::new(), id.clone());
    }
    let mut context = ImportWalkContext {
        state,
        attachment,
        kb_id,
        preserve_hierarchy,
        attachment_paths: &attachment_paths,
        folders: &mut folders,
    };
    walk_directory(&mut context, parent.as_deref(), root, Path::new(""), result)?;
    import_attachment_manifest(&mut context, parent.as_deref(), &manifest, result);
    Ok(())
}

fn walk_directory(
    context: &mut ImportWalkContext<'_>,
    parent_id: Option<&str>,
    dir: &Path,
    relative: &Path,
    result: &mut ImportResult,
) -> AppResult<()> {
    let mut entries = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        // 隐藏文件/目录（.git、.DS_Store 等）不是用户内容，扫描与导入保持一致跳过。
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let child_relative = relative.join(&name);
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
            if context.preserve_hierarchy {
                let title = name.to_str().unwrap_or("文件夹");
                let folder = create_folder(context.state, context.kb_id, parent_id, title)?;
                result.created_folder_ids.push(folder.id.clone());
                context
                    .folders
                    .insert(child_relative.clone(), folder.id.clone());
                walk_directory(context, Some(&folder.id), &path, &child_relative, result)?;
            } else {
                walk_directory(context, parent_id, &path, &child_relative, result)?;
            }
        } else if !context.attachment_paths.contains(&child_relative) && is_supported(&path) {
            let outcome = import_file(
                context.state,
                context.attachment,
                context.kb_id,
                parent_id,
                &path,
            )?;
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

/// 读取整库导出清单中的 `attachmentNodes`；无清单或解析失败返回空。
fn read_attachment_manifest(root: &Path) -> Vec<AttachmentManifestEntry> {
    let manifest_path = root.join(MANIFEST_FILE);
    let Ok(raw) = fs::read_to_string(&manifest_path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        logging::error("import", "整库清单解析失败，按普通目录导入");
        return Vec::new();
    };
    let Some(entries) = value.get("attachmentNodes").and_then(Value::as_array) else {
        return Vec::new();
    };
    entries
        .iter()
        .filter_map(|entry| {
            let title = entry.get("title").and_then(Value::as_str)?.to_string();
            let raw_path = entry.get("path").and_then(Value::as_str)?;
            let declared = PathBuf::from(raw_path);
            let path = if declared.is_file() {
                declared
            } else {
                let name = declared.file_name()?.to_str()?;
                find_file_by_name(root, name)?
            };
            let relative = path.strip_prefix(root).ok().map(Path::to_path_buf);
            let mime = entry
                .get("mime")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            Some(AttachmentManifestEntry {
                title: if title.trim().is_empty() {
                    path.file_stem()?.to_str()?.to_string()
                } else {
                    title
                },
                path,
                relative,
                mime,
            })
        })
        .collect()
}

/// 在导出根目录下按文件名查找附件；导出被搬移后绝对路径会失效。
fn find_file_by_name(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(|value| value.to_str()) == Some(name) && path.is_file() {
            return Some(path);
        }
        if path.is_dir()
            && !path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with('.'))
            && let Some(found) = find_file_by_name(&path, name)
        {
            return Some(found);
        }
    }
    None
}

/// 从 manifest 恢复附件节点；文件缺失记失败，父文件夹找不到时回退到根级。
fn import_attachment_manifest(
    context: &mut ImportWalkContext<'_>,
    parent_id: Option<&str>,
    manifest: &[AttachmentManifestEntry],
    result: &mut ImportResult,
) {
    for entry in manifest {
        let Some(relative) = entry.relative.as_ref() else {
            result
                .files
                .push(failure(&entry.path, "附件不在导入目录内".to_string()));
            result.failed += 1;
            continue;
        };
        if !entry.path.is_file() {
            result
                .files
                .push(failure(&entry.path, "附件文件缺失".to_string()));
            result.failed += 1;
            continue;
        }
        let parent_relative = relative.parent().unwrap_or_else(|| Path::new(""));
        let target_parent = if context.preserve_hierarchy {
            context
                .folders
                .get(parent_relative)
                .map(String::as_str)
                .or(parent_id)
        } else {
            parent_id
        };
        let mut warnings = Vec::new();
        if context.preserve_hierarchy
            && !parent_relative.as_os_str().is_empty()
            && target_parent == parent_id
        {
            warnings.push("附件原文件夹未找到，已放到当前目录".to_string());
        }
        let uploaded = attachment_service::upload(
            context.attachment,
            UploadAttachmentInput {
                source_path: entry.path.to_string_lossy().into_owned(),
                logical_path: String::new(),
                name: Some(entry.title.clone()),
                mime: entry.mime.clone(),
                scope: Some(SCOPE_NODE.to_string()),
                ttl_seconds: None,
            },
        );
        let uploaded = match uploaded {
            Ok(value) => value,
            Err(error) => {
                result
                    .files
                    .push(failure(&entry.path, format!("附件上传失败：{error}")));
                result.failed += 1;
                continue;
            }
        };
        let node = node_service::create_attachment_node(
            context.state,
            CreateAttachmentNodeInput {
                knowledge_base_id: context.kb_id.to_string(),
                parent_id: target_parent.map(str::to_string),
                object_id: uploaded.id.clone(),
            },
        );
        match node {
            Ok(node) => {
                result.imported += 1;
                result.files.push(ImportFileResult {
                    source_path: entry.path.to_string_lossy().into_owned(),
                    node_id: Some(node.id),
                    title: node.title,
                    ok: true,
                    message: None,
                    warnings,
                    attachment_count: 0,
                });
            }
            Err(error) => {
                let _ = attachment_service::delete(context.attachment, &uploaded.id);
                result
                    .files
                    .push(failure(&entry.path, format!("附件节点创建失败：{error}")));
                result.failed += 1;
            }
        }
    }
}

/// 导入 `.excalidraw`：创建画板节点并上传内嵌图片。
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
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if is_mindmap_file(path, file_name) {
        let result = crate::services::mindmap_import_service::import(
            state,
            kb_id,
            parent_id,
            &[path.to_string_lossy().into_owned()],
        )?;
        return Ok(result
            .files
            .into_iter()
            .next()
            .unwrap_or_else(|| failure(path, "思维导图导入未创建节点".to_string())));
    }
    if !is_supported(path) {
        return Ok(failure(path, "这个文件暂时无法导入。".to_string()));
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
                    "content": [{"type": "text", "text": "内容暂时无法转换，原始文件已作为附件保留。"}],
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
            base_version: 0,
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

/// 导入前按文件元数据校验体积；超限直接拒绝，避免整份读入内存。
fn ensure_import_size(path: &Path, max_bytes: u64, kind: &str) -> AppResult<()> {
    let size = fs::metadata(path)
        .map_err(|error| {
            logging::error("import", &format!("读取文件信息失败: {error}"));
            AppError::validation("文件不存在或不可读取")
        })?
        .len();
    if size > max_bytes {
        return Err(AppError::validation(format!(
            "{kind}文件过大（最大 {} MB）",
            max_bytes / 1024 / 1024
        )));
    }
    Ok(())
}

fn parse_content(
    attachment: &AttachmentContext,
    path: &Path,
    asset_prefix: &str,
) -> AppResult<ParsedContent> {
    let extension = extension(path);
    if MARKDOWN_EXTENSIONS.contains(&extension.as_str()) {
        ensure_import_size(path, MAX_TEXT_IMPORT_BYTES, "Markdown ")?;
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
        ensure_import_size(path, MAX_WORD_IMPORT_BYTES, "Word ")?;
        let parsed = parse_word(attachment, path, asset_prefix)?;
        return Ok(ParsedContent {
            blocks: parsed.blocks,
            warnings: parsed.warnings,
            attachment_count: parsed.attachment_count,
        });
    }
    if PDF_EXTENSIONS.contains(&extension.as_str()) {
        let parsed = parse_pdf(attachment, path, asset_prefix)?;
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
    // 按名做索引点查：以前每导入一个文件都拉 200 行附件再建集合，批量导入是 O(文件数 × 200)。
    let Ok(connection) = context.connection() else {
        return desired.to_string();
    };
    let taken = |name: &str| -> bool {
        crate::repositories::attachment_repository::name_exists(&connection, "attach", name)
            .unwrap_or(false)
    };
    if !taken(desired) {
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
        if !taken(&candidate) {
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

/// 混合导入预扫描：只读分类，不创建节点或对象。
///
/// 与真正的导入共用同一套扩展名判定；Markdown 引用的本地文件先去重收集，
/// 这样「被引用的附件」不会被误报成「不支持、将跳过」。
pub fn scan_folder(folder_path: &str) -> AppResult<ImportScanResult> {
    let root = Path::new(folder_path);
    if !root.is_absolute() || !root.is_dir() {
        return Err(AppError::validation("请选择要导入的文件夹"));
    }
    let root_canonical = root
        .canonicalize()
        .map_err(|_| AppError::validation("文件夹无法读取"))?;

    let mut files = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut visited = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        if depth > MAX_SCAN_DEPTH {
            continue;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.filter_map(Result::ok) {
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.') {
                continue;
            }
            visited += 1;
            if visited > MAX_SCAN_FILES {
                return Err(AppError::validation(
                    "文件夹内文件过多（超过 5 万），请分批导入",
                ));
            }
            let path = entry.path();
            let Ok(metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push((path, depth + 1));
            } else if metadata.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();

    let mut referenced: HashSet<PathBuf> = HashSet::new();
    for file in &files {
        if !MARKDOWN_EXTENSIONS.contains(&extension(file).as_str()) {
            continue;
        }
        let Ok(text) = fs::read_to_string(file) else {
            continue;
        };
        let base = file.parent().unwrap_or(root);
        for dest in collect_markdown_refs(&text) {
            if let Some(path) = resolve_markdown_reference(&root_canonical, base, &dest) {
                referenced.insert(path);
            }
        }
    }

    let mut documents = 0usize;
    let mut boards = 0usize;
    let mut mindmaps = 0usize;
    let mut attachments = 0usize;
    let mut unsupported = Vec::new();
    for file in &files {
        if is_document_file(file) {
            documents += 1;
        } else if is_excalidraw_file(file) {
            boards += 1;
        } else if is_mindmap_file(file, file_name(file)) {
            mindmaps += 1;
        } else if is_import_metadata(file) {
            // 整库导出的清单由导入器自己读取，不算用户内容。
        } else {
            let canonical = fs::canonicalize(file).unwrap_or_else(|_| file.clone());
            if referenced.contains(&canonical) {
                attachments += 1;
            } else {
                unsupported.push(ImportScanSkippedFile {
                    path: relative_display(root, file),
                    extension: extension(file),
                });
            }
        }
    }
    unsupported.sort_by(|left, right| left.path.cmp(&right.path));
    let unsupported_count = unsupported.len();
    unsupported.truncate(MAX_SCAN_REPORTED);

    logging::info(
        "import",
        &format!(
            "混合导入扫描 root={} files={} docs={documents} boards={boards} mindmaps={mindmaps} attachments={attachments} skipped={unsupported_count}",
            root.display(),
            files.len()
        ),
    );

    Ok(ImportScanResult {
        root: root.to_string_lossy().into_owned(),
        total_files: files.len(),
        documents,
        boards,
        mindmaps,
        attachments,
        unsupported_count,
        unsupported,
    })
}

fn collect_markdown_refs(text: &str) -> Vec<String> {
    Parser::new_ext(text, Options::empty())
        .filter_map(|event| match event {
            Event::Start(Tag::Link { dest_url, .. })
            | Event::Start(Tag::Image { dest_url, .. }) => Some(dest_url.to_string()),
            _ => None,
        })
        .collect()
}

/// 解析 Markdown 里的本地引用；外链、锚点与目录外路径一律不算附件。
fn resolve_markdown_reference(root: &Path, base: &Path, dest: &str) -> Option<PathBuf> {
    let lower = dest.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
        || lower.starts_with("data:")
        || lower.starts_with('#')
    {
        return None;
    }
    let without_query = dest.split(['#', '?']).next().unwrap_or_default();
    let decoded = percent_encoding::percent_decode_str(without_query)
        .decode_utf8()
        .ok()?
        .into_owned();
    if decoded.trim().is_empty() {
        return None;
    }
    let candidate = base.join(decoded.trim_start_matches("./"));
    let canonical = candidate.canonicalize().ok()?;
    (canonical.starts_with(root) && canonical.is_file()).then_some(canonical)
}

fn is_import_metadata(path: &Path) -> bool {
    IMPORT_METADATA_FILES.contains(&file_name(path))
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_supported(path: &Path) -> bool {
    is_document_file(path) || is_excalidraw_file(path) || is_mindmap_file(path, file_name(path))
}

fn is_document_file(path: &Path) -> bool {
    let extension = extension(path);
    MARKDOWN_EXTENSIONS.contains(&extension.as_str())
        || WORD_EXTENSIONS.contains(&extension.as_str())
        || PDF_EXTENSIONS.contains(&extension.as_str())
}

fn is_excalidraw_file(path: &Path) -> bool {
    EXCALIDRAW_EXTENSIONS.contains(&extension(path).as_str())
}

fn is_mindmap_file(path: &Path, name: &str) -> bool {
    matches!(extension(path).as_str(), "xmind" | "mm" | "opml")
        || name.ends_with(".starris-mindmap.json")
}

fn file_name(path: &Path) -> &str {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_size_guard_reads_metadata_only() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("huge.md");
        let file = fs::File::create(&path).expect("建文件");
        file.set_len(MAX_TEXT_IMPORT_BYTES + 1).expect("写稀疏文件");
        drop(file);
        let error = ensure_import_size(&path, MAX_TEXT_IMPORT_BYTES, "Markdown ")
            .expect_err("超限必须拒绝");
        assert!(
            format!("{error}").contains("过大"),
            "错误信息要说明过大：{error}"
        );
        assert!(ensure_import_size(&path, u64::MAX, "Markdown ").is_ok());
    }
}
