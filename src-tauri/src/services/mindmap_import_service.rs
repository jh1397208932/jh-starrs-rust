//! 思维导图批量导入。
//!
//! 每个文件先解析成 canonical tree，再创建节点与场景。多画布 XMind 会创建一个
//! 文件夹，并在其中为每个画布建立独立思维导图节点，避免静默丢内容。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::domain::NodeType;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::CreateNodeInput;
use crate::models::exchange::{ImportFileResult, ImportResult};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::{mindmap_format, mindmap_service, node_service};
use crate::state::AppState;
use crate::utils::new_id;

/// 导入一个或多个思维导图文件。
pub fn import(
    state: &AppState,
    knowledge_base_id: &str,
    parent_id: Option<&str>,
    paths: &[String],
) -> AppResult<ImportResult> {
    if paths.is_empty() {
        return Err(AppError::validation("请选择要导入的思维导图文件"));
    }
    let context = AttachmentContext::from_state(state)?;
    let mut result = ImportResult::default();
    for raw in paths {
        let path = PathBuf::from(raw);
        let outcome = import_one(
            state,
            &context,
            knowledge_base_id,
            parent_id,
            &path,
            &mut result,
        );
        match outcome {
            Ok(files) => {
                for file in files {
                    if file.ok {
                        result.imported += 1;
                    } else {
                        result.failed += 1;
                    }
                    result.files.push(file);
                }
            }
            Err(error) => {
                result.failed += 1;
                result.files.push(ImportFileResult {
                    source_path: raw.clone(),
                    node_id: None,
                    title: path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("思维导图")
                        .to_string(),
                    ok: false,
                    message: Some(error.to_string()),
                    warnings: Vec::new(),
                    attachment_count: 0,
                });
            }
        }
    }
    logging::info(
        "mindmap",
        &format!(
            "思维导图导入完成 kb={} imported={} failed={}",
            knowledge_base_id, result.imported, result.failed
        ),
    );
    Ok(result)
}

fn import_one(
    state: &AppState,
    context: &AttachmentContext,
    knowledge_base_id: &str,
    parent_id: Option<&str>,
    path: &Path,
    result: &mut ImportResult,
) -> AppResult<Vec<ImportFileResult>> {
    if !path.is_absolute() {
        return Err(AppError::validation("导入路径必须是绝对路径"));
    }
    if !path.is_file() {
        return Err(AppError::validation("思维导图文件不存在"));
    }
    let imported = mindmap_format::parse(path)?;
    let file_title = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("思维导图")
        .to_string();
    let target_parent = if imported.len() > 1 {
        let folder = node_service::create(
            state,
            CreateNodeInput {
                knowledge_base_id: knowledge_base_id.to_string(),
                parent_id: parent_id.map(str::to_string),
                node_type: NodeType::Folder.as_i64(),
                title: format!("{file_title} 导图"),
            },
        )?;
        result.created_folder_ids.push(folder.id.clone());
        Some(folder.id)
    } else {
        parent_id.map(str::to_string)
    };

    let mut files = Vec::new();
    for sheet in imported {
        let mut content = sheet.content;
        let mut replacements = BTreeMap::new();
        let mut dropped_images = Vec::new();
        let logical_path = format!("mindmap-import/{}", new_id());
        for (resource, bytes, mime) in sheet.image_resources {
            let name = Path::new(&resource)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("image.png")
                .to_string();
            match attachment_service::upload_bytes(
                context,
                name,
                logical_path.clone(),
                Some(mime),
                bytes,
            ) {
                Ok(attachment) => {
                    replacements.insert(resource, attachment.id);
                }
                Err(error) => {
                    // 空替换值让图片本身被丢弃（连同引用），单张图失败不再拖垮整张画布。
                    replacements.insert(resource.clone(), String::new());
                    dropped_images.push(resource.clone());
                    logging::error(
                        "mindmap",
                        &format!("导入 XMind 图片资源失败 resource={resource}: {error}"),
                    );
                }
            }
        }
        mindmap_format::replace_image_object_ids(&mut content, &replacements);
        let title = unique_title(&sheet.title, &file_title);
        let node = match node_service::create(
            state,
            CreateNodeInput {
                knowledge_base_id: knowledge_base_id.to_string(),
                parent_id: target_parent.clone(),
                node_type: NodeType::Mindmap.as_i64(),
                title,
            },
        ) {
            Ok(node) => node,
            Err(error) => {
                files.push(failed_file(path, &sheet.title, &error.to_string()));
                continue;
            }
        };
        let mut warnings: Vec<String> = sheet
            .warnings
            .into_iter()
            .filter(|warning| !replacements.contains_key(warning))
            .collect();
        warnings.extend(
            dropped_images
                .into_iter()
                .map(|resource| format!("图片资源导入失败，已忽略：{resource}")),
        );
        match mindmap_service::save(
            state,
            crate::models::mindmap::MindmapSaveInput {
                node_id: node.id.clone(),
                base_version: 0,
                content,
            },
        ) {
            Ok(_) => files.push(ImportFileResult {
                source_path: path.to_string_lossy().into_owned(),
                node_id: Some(node.id.clone()),
                title: node.title,
                ok: true,
                message: None,
                warnings,
                attachment_count: replacements.len(),
            }),
            Err(error) => {
                files.push(failed_file(path, &node.title, &error.to_string()));
            }
        }
    }
    Ok(files)
}

fn unique_title(sheet_title: &str, fallback: &str) -> String {
    let title = sheet_title.trim();
    if title.is_empty() {
        fallback.to_string()
    } else {
        title.chars().take(200).collect()
    }
}

fn failed_file(path: &Path, title: &str, message: &str) -> ImportFileResult {
    ImportFileResult {
        source_path: path.to_string_lossy().into_owned(),
        node_id: None,
        title: title.to_string(),
        ok: false,
        message: Some(message.to_string()),
        warnings: Vec::new(),
        attachment_count: 0,
    }
}
