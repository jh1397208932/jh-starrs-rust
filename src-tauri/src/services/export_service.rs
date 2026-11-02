//! 导出用例：单文档四格式导出与知识库整树导出。
//!
//! 本层只做 DB 读取、目录/文件名规划与附件落盘；正文到各格式的转换在
//! `export_render`。导出的附件统一放在文档文件同级的 `attach/` 下，
//! Markdown 链接使用相对路径，保证整个目录可搬运。

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde_json::{Map, Value, json};

use crate::db;
use crate::domain::NodeType;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::attachment::{AttachmentDto, AttachmentListQuery, DownloadAttachmentInput};
use crate::models::{
    BoardExportTarget, ExportDocumentInput, ExportFileDto, ExportFormat, ExportKnowledgeBaseInput,
    ExportResult, ExportWriteFileInput, MindmapExportTarget, NodeDto,
};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::export_render::{self, RenderAttachment, RenderContext};
use crate::services::mindmap_format::{self, MindmapFormat};
use crate::services::{
    board_service, document_service, knowledge_base_service, mindmap_service, node_service,
};
use crate::state::AppState;

/// `.excalidraw` 内嵌图片上限；超过时只复制原文件，避免源文件无限膨胀。
const MAX_EMBED_IMAGE_BYTES: i64 = 20 * 1024 * 1024;
/// 前端渲染文件写入上限，防止异常 IPC 占满内存。
const MAX_EXPORT_FILE_BYTES: usize = 128 * 1024 * 1024;

/// 单文档导出。
pub fn export_document(state: &AppState, input: ExportDocumentInput) -> AppResult<ExportResult> {
    let node = node_service::get(state, &input.node_id)?;
    if node.node_type != 2 {
        return Err(AppError::validation("仅文档支持导出"));
    }
    let mut dest = PathBuf::from(&input.dest_path);
    if !dest.is_absolute() {
        return Err(AppError::validation("导出位置无效"));
    }
    let expected_extension = input.format.extension();
    let has_expected = dest
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(expected_extension));
    if !has_expected {
        dest.set_extension(expected_extension);
    }
    let parent = dest
        .parent()
        .ok_or_else(|| AppError::validation("导出位置无效"))?;
    fs::create_dir_all(parent)?;
    let attachment_context = AttachmentContext::from_state(state)?;
    let loaded = document_service::load(state, &node.id)?;
    let attach_dir = parent.join("attach");
    fs::create_dir_all(&attach_dir)?;
    let mut warnings = Vec::new();
    let mut used = HashSet::new();
    let prepared = prepare_render(
        &attachment_context,
        &loaded.document,
        &node.title,
        &attach_dir,
        "attach",
        &mut used,
        &mut warnings,
    )?;

    let mut result = ExportResult {
        root_path: db::paths::path_to_string(&dest)?,
        warnings,
        ..Default::default()
    };
    write_document(&prepared.ctx, input.format, &dest, &mut result.files)?;
    result.attachment_count = prepared.ctx.attachments.len();
    result.files.extend(prepared.files);
    logging::info(
        "export",
        &format!(
            "导出文档 node={} format={:?} attachments={} dest={}",
            node.id,
            input.format,
            result.attachment_count,
            dest.display()
        ),
    );
    Ok(result)
}

/// 知识库整树导出；目录层级与文件树一致，每个文档同级带 `attach/`。
pub fn export_knowledge_base(
    state: &AppState,
    input: ExportKnowledgeBaseInput,
) -> AppResult<ExportResult> {
    let kb = knowledge_base_service::get(state, &input.knowledge_base_id)?;
    let dest_dir = PathBuf::from(&input.dest_dir);
    if !dest_dir.is_absolute() {
        return Err(AppError::validation("导出位置无效"));
    }
    fs::create_dir_all(&dest_dir)?;
    let root = unique_directory(
        &dest_dir,
        &safe_component(&kb.name, "知识库"),
        &mut HashSet::new(),
    );
    let root = dest_dir.join(root);
    fs::create_dir_all(&root)?;

    let attachment_context = AttachmentContext::from_state(state)?;
    let nodes = node_service::list(state, &kb.id)?;
    for node in &nodes {
        // 只接受当前存在的节点类型；库里出现未知/已下线的类型说明数据已损坏。
        NodeType::from_i64(node.node_type)?;
    }
    let mut children_by_parent: BTreeMap<Option<String>, Vec<NodeDto>> = BTreeMap::new();
    for node in &nodes {
        children_by_parent
            .entry(node.parent_id.clone())
            .or_default()
            .push(node.clone());
    }
    for siblings in children_by_parent.values_mut() {
        siblings.sort_by(|left, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then(left.created_at.cmp(&right.created_at))
                .then(left.id.cmp(&right.id))
        });
    }

    let mut result = ExportResult {
        root_path: db::paths::path_to_string(&root)?,
        ..Default::default()
    };
    let mut referenced_attachments = BTreeSet::new();
    export_children(
        state,
        &attachment_context,
        &children_by_parent,
        None,
        &root,
        input.format,
        &mut referenced_attachments,
        &mut result,
    )?;

    // 未被任何文档引用的活跃附件也要带走，避免“全部导出”漏数据。
    export_unreferenced_attachments(
        &attachment_context,
        &referenced_attachments,
        &root,
        &mut result,
    )?;

    let manifest = json!({
        "format": input.format.label(),
        "knowledgeBase": { "id": kb.id, "name": kb.name },
        "exportedAt": crate::utils::now_ms(),
        "tree": build_tree(&nodes),
        "boards": result.boards.iter().map(|board| json!({
            "nodeId": board.node_id,
            "title": board.title,
            "dir": board.dir_path,
            "formats": ["excalidraw", "png", "svg"],
            "excalidraw": board.excalidraw_path,
            "png": board.png_path,
            "svg": board.svg_path,
            "note": "画板固定导出三种格式；PNG/SVG 由桌面端渲染，失败会写入导出结果 warnings。",
        })).collect::<Vec<_>>(),
        "mindmaps": result.mindmaps.iter().map(|mindmap| json!({
            "nodeId": mindmap.node_id,
            "title": mindmap.title,
            "dir": mindmap.dir_path,
            "formats": ["native", "xmind", "markdown", "png", "svg"],
            "native": mindmap.native_path,
            "xmind": mindmap.xmind_path,
            "markdown": mindmap.markdown_path,
            "png": mindmap.png_path,
            "svg": mindmap.svg_path,
            "note": "思维导图固定导出原生 JSON、XMind 与 Markdown；PNG/SVG 由桌面端渲染。",
        })).collect::<Vec<_>>(),
        "files": result.files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        "attachments": result.attachment_count,
        "attachmentNodes": result.attachment_nodes,
        "warnings": result.warnings,
    });
    let manifest_path = root.join("manifest.json");
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).unwrap_or_default(),
    )?;
    result.files.push(ExportFileDto {
        path: db::paths::path_to_string(&manifest_path)?,
        kind: "manifest".to_string(),
    });
    let readme_path = root.join("导出说明.md");
    let readme = format!(
        "# {} 导出\n\n- 格式：{}\n- 导出时间：{}\n- 文档树：与本目录结构一致\n- 附件节点：写在与文件树对应的位置\n- 文档附件：每个文档同级的 `attach/` 目录；未引用附件在 `_attachments/`\n- 画板：每个画板一个同名目录，含 `.excalidraw`、`.png`、`.svg` 与图片目录 `attach/`\n- 清单：`manifest.json` 记录全部文件与警告\n",
        kb.name,
        input.format.label(),
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    fs::write(&readme_path, readme)?;
    result.files.push(ExportFileDto {
        path: db::paths::path_to_string(&readme_path)?,
        kind: "manifest".to_string(),
    });
    logging::info(
        "export",
        &format!(
            "导出知识库 kb={} format={:?} docs={} boards={} files={} attachments={} root={}",
            kb.id,
            input.format,
            nodes.iter().filter(|node| node.node_type == 2).count(),
            result.boards.len(),
            result.files.len(),
            result.attachment_count,
            root.display()
        ),
    );
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn export_children(
    state: &AppState,
    attachment_context: &AttachmentContext,
    children_by_parent: &BTreeMap<Option<String>, Vec<NodeDto>>,
    parent_id: Option<&str>,
    dir: &Path,
    format: ExportFormat,
    referenced: &mut BTreeSet<String>,
    result: &mut ExportResult,
) -> AppResult<()> {
    let Some(children) = children_by_parent.get(&parent_id.map(str::to_string)) else {
        return Ok(());
    };
    let mut used = HashSet::new();
    for node in children {
        match node.node_type {
            1 => {
                let name = unique_directory(dir, &safe_component(&node.title, "文件夹"), &mut used);
                let child_dir = dir.join(name);
                fs::create_dir_all(&child_dir)?;
                export_children(
                    state,
                    attachment_context,
                    children_by_parent,
                    Some(&node.id),
                    &child_dir,
                    format,
                    referenced,
                    result,
                )?;
            }
            2 => {
                let stem =
                    unique_file_stem(dir, &safe_component(&node.title, "文档"), "md", &mut used);
                let file_name = format!("{stem}.{}", format.extension());
                let path = dir.join(&file_name);
                let attach_root = dir.join("attach");
                let attachment_subdir =
                    safe_component(&format!("{stem}-{}", short_id(&node.id)), "attach");
                let attach_dir = attach_root.join(&attachment_subdir);
                fs::create_dir_all(&attach_dir)?;
                let rel_prefix = format!("attach/{attachment_subdir}");
                let loaded = document_service::load(state, &node.id)?;
                let mut local_used = HashSet::new();
                let prepared = prepare_render(
                    attachment_context,
                    &loaded.document,
                    &node.title,
                    &attach_dir,
                    &rel_prefix,
                    &mut local_used,
                    &mut result.warnings,
                )?;
                for id in prepared.ctx.attachments.keys() {
                    referenced.insert(id.clone());
                }
                write_document(&prepared.ctx, format, &path, &mut result.files)?;
                result.attachment_count += prepared.ctx.attachments.len();
                result.files.extend(prepared.files);
            }
            3 => {
                export_board(
                    state,
                    attachment_context,
                    node,
                    dir,
                    &mut used,
                    referenced,
                    result,
                )?;
            }
            6 => {
                export_attachment_node(
                    attachment_context,
                    node,
                    dir,
                    &mut used,
                    referenced,
                    result,
                )?;
            }
            7 => {
                export_mindmap(
                    state,
                    attachment_context,
                    node,
                    dir,
                    &mut used,
                    referenced,
                    result,
                )?;
            }
            other => {
                logging::error("export", &format!("导出遇到未知节点类型 type={other}"));
                return Err(AppError::validation("内容类型无效"));
            }
        }
    }
    Ok(())
}

/// 导出附件节点：在树对应位置写原文件，并登记 manifest 落点。
fn export_attachment_node(
    context: &AttachmentContext,
    node: &NodeDto,
    dir: &Path,
    used: &mut HashSet<String>,
    referenced: &mut BTreeSet<String>,
    result: &mut ExportResult,
) -> AppResult<()> {
    let meta = match attachment_service::get_by_node(context, &node.id) {
        Ok(meta) => meta,
        Err(error) => {
            result
                .warnings
                .push(format!("附件「{}」不可用，已跳过：{error}", node.title));
            return Ok(());
        }
    };
    let name = unique_name(dir, &safe_component(&meta.name, "附件"), used);
    let path = dir.join(&name);
    if let Err(error) = copy_attachment(context, &meta, &path) {
        result
            .warnings
            .push(format!("附件「{}」导出失败：{error}", meta.name));
        return Ok(());
    }
    referenced.insert(meta.id.clone());
    result.attachment_count += 1;
    result.files.push(ExportFileDto {
        path: db::paths::path_to_string(&path)?,
        kind: "attachment".to_string(),
    });
    result
        .attachment_nodes
        .push(crate::models::exchange::ExportedAttachmentNode {
            node_id: node.id.clone(),
            object_id: meta.id,
            title: node.title.clone(),
            path: db::paths::path_to_string(&path)?,
            size: meta.size,
            mime: meta.mime,
        });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn export_board(
    state: &AppState,
    context: &AttachmentContext,
    node: &NodeDto,
    parent_dir: &Path,
    used_dirs: &mut HashSet<String>,
    referenced: &mut BTreeSet<String>,
    result: &mut ExportResult,
) -> AppResult<()> {
    let folder = unique_directory(parent_dir, &safe_component(&node.title, "画板"), used_dirs);
    let board_dir = parent_dir.join(&folder);
    fs::create_dir_all(&board_dir)?;

    let snapshot = match board_service::snapshot(state, &node.id) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            result
                .warnings
                .push(format!("画板「{}」场景读取失败：{error}", node.title));
            let metadata_path = board_dir.join("metadata.json");
            fs::write(
                &metadata_path,
                serde_json::to_vec_pretty(&json!({
                    "id": node.id,
                    "title": node.title,
                    "type": node.node_type,
                    "createdAt": node.created_at,
                    "updatedAt": node.updated_at,
                    "note": "画板场景读取失败，未导出画板正文。",
                }))
                .unwrap_or_default(),
            )?;
            result.files.push(ExportFileDto {
                path: db::paths::path_to_string(&metadata_path)?,
                kind: "metadata".to_string(),
            });
            return Ok(());
        }
    };

    let attach_dir = board_dir.join("attach");
    fs::create_dir_all(&attach_dir)?;
    let image_ids = board_service::collect_image_object_ids(&snapshot.elements);
    let object_ids = image_ids.clone();
    let mut used_names = HashSet::new();
    let mut files_map = Map::new();

    for object_id in object_ids {
        let meta = match attachment_service::get(context, &object_id) {
            Ok(meta) => meta,
            Err(error) => {
                result.warnings.push(format!(
                    "画板「{}」的图片 {object_id} 不存在：{error}",
                    node.title
                ));
                continue;
            }
        };
        let name = unique_name(
            &attach_dir,
            &safe_component(&meta.name, "附件"),
            &mut used_names,
        );
        let target = attach_dir.join(&name);
        if let Err(error) = copy_attachment(context, &meta, &target) {
            result.warnings.push(format!(
                "画板「{}」附件「{}」导出失败：{error}",
                node.title, meta.name
            ));
            continue;
        }
        referenced.insert(object_id.clone());
        result.attachment_count += 1;
        result.files.push(ExportFileDto {
            path: db::paths::path_to_string(&target)?,
            kind: "attachment".to_string(),
        });

        let mime = meta.mime.clone();
        // 画板图元只认原生 image；图片同时写入 files 映射，重新导入时可直接回填。
        if image_ids.contains(&object_id) && mime.starts_with("image/") {
            match attachment_service::read_image_object(context, &object_id, MAX_EMBED_IMAGE_BYTES)
            {
                Ok((_, bytes)) => {
                    files_map.insert(
                        object_id.clone(),
                        json!({
                            "mimeType": mime,
                            "dataURL": format!("data:{};base64,{}", mime, BASE64.encode(&bytes)),
                            "created": meta.created_at,
                        }),
                    );
                }
                Err(error) => result.warnings.push(format!(
                    "画板「{}」图片「{}」未内嵌到 .excalidraw：{error}",
                    node.title, meta.name
                )),
            }
        }
    }

    let excalidraw = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "starris",
        "elements": snapshot.elements,
        "appState": snapshot.app_state,
        "files": Value::Object(files_map),
    });
    let excalidraw_path = board_dir.join(format!("{folder}.excalidraw"));
    fs::write(
        &excalidraw_path,
        serde_json::to_vec_pretty(&excalidraw).unwrap_or_default(),
    )?;
    result.files.push(ExportFileDto {
        path: db::paths::path_to_string(&excalidraw_path)?,
        kind: "board".to_string(),
    });

    let png_path = board_dir.join(format!("{folder}.png"));
    let svg_path = board_dir.join(format!("{folder}.svg"));
    result.boards.push(BoardExportTarget {
        node_id: node.id.clone(),
        title: node.title.clone(),
        dir_path: db::paths::path_to_string(&board_dir)?,
        base_name: folder.clone(),
        excalidraw_path: db::paths::path_to_string(&excalidraw_path)?,
        png_path: db::paths::path_to_string(&png_path)?,
        svg_path: db::paths::path_to_string(&svg_path)?,
    });
    Ok(())
}

/// 整库导出一个思维导图：原生 JSON + XMind + Markdown，图片对象另存 attach/。
#[allow(clippy::too_many_arguments)]
fn export_mindmap(
    state: &AppState,
    context: &AttachmentContext,
    node: &NodeDto,
    parent_dir: &Path,
    used_dirs: &mut HashSet<String>,
    referenced: &mut BTreeSet<String>,
    result: &mut ExportResult,
) -> AppResult<()> {
    let folder = unique_directory(
        parent_dir,
        &safe_component(&node.title, "思维导图"),
        used_dirs,
    );
    let dir = parent_dir.join(&folder);
    fs::create_dir_all(&dir)?;
    let attach_dir = dir.join("attach");
    fs::create_dir_all(&attach_dir)?;
    let snapshot = mindmap_service::snapshot(state, &node.id)?;
    let object_ids = mindmap_format::image_object_ids(&snapshot.content);
    let mut used_names = HashSet::new();
    for object_id in &object_ids {
        let meta = match attachment_service::get(context, object_id) {
            Ok(meta) => meta,
            Err(error) => {
                result.warnings.push(format!(
                    "思维导图「{}」的图片 {object_id} 不存在：{error}",
                    node.title
                ));
                continue;
            }
        };
        let name = unique_name(
            &attach_dir,
            &safe_component(&meta.name, "图片"),
            &mut used_names,
        );
        let target = attach_dir.join(&name);
        match attachment_service::read_image_object(context, object_id, MAX_EMBED_IMAGE_BYTES) {
            Ok((_, bytes)) => {
                fs::write(&target, bytes)?;
                referenced.insert(object_id.clone());
                result.attachment_count += 1;
                result.files.push(ExportFileDto {
                    path: db::paths::path_to_string(&target)?,
                    kind: "attachment".to_string(),
                });
            }
            Err(error) => result.warnings.push(format!(
                "思维导图「{}」图片「{}」导出失败：{error}",
                node.title, meta.name
            )),
        }
    }
    let native_path = dir.join(format!("{folder}.starris-mindmap.json"));
    let xmind_path = dir.join(format!("{folder}.xmind"));
    let markdown_path = dir.join(format!("{folder}.md"));
    let svg_path = dir.join(format!("{folder}.svg"));
    let png_path = dir.join(format!("{folder}.png"));
    let image_loader = |object_id: &str| -> AppResult<(Vec<u8>, String)> {
        let (attachment, bytes) =
            attachment_service::read_image_object(context, object_id, MAX_EMBED_IMAGE_BYTES)?;
        let extension = attachment
            .name
            .rsplit('.')
            .next()
            .unwrap_or("png")
            .to_ascii_lowercase();
        Ok((bytes, extension))
    };
    for (format, path) in [
        (MindmapFormat::Native, &native_path),
        (MindmapFormat::Xmind, &xmind_path),
        (MindmapFormat::Markdown, &markdown_path),
    ] {
        let exported =
            mindmap_format::export(&snapshot.content, &node.title, format, Some(&image_loader))?;
        fs::write(path, exported.bytes)?;
        result.files.push(ExportFileDto {
            path: db::paths::path_to_string(path)?,
            kind: "mindmap".to_string(),
        });
    }
    result.mindmaps.push(MindmapExportTarget {
        node_id: node.id.clone(),
        title: node.title.clone(),
        dir_path: db::paths::path_to_string(&dir)?,
        base_name: folder.clone(),
        native_path: db::paths::path_to_string(&native_path)?,
        xmind_path: db::paths::path_to_string(&xmind_path)?,
        markdown_path: db::paths::path_to_string(&markdown_path)?,
        svg_path: db::paths::path_to_string(&svg_path)?,
        png_path: db::paths::path_to_string(&png_path)?,
    });
    Ok(())
}

/// 写入前端渲染的 PNG/SVG 或 `serializeAsJSON` 生成的 `.excalidraw`。
pub fn write_export_file(input: ExportWriteFileInput) -> AppResult<ExportFileDto> {
    let path = PathBuf::from(&input.path);
    if !path.is_absolute() {
        return Err(AppError::validation("导出位置无效"));
    }
    if input.data_base64.len() > MAX_EXPORT_FILE_BYTES * 2 {
        return Err(AppError::validation("导出文件过大"));
    }
    let bytes = BASE64
        .decode(input.data_base64.as_bytes())
        .map_err(|error| {
            logging::error("export", &format!("导出 base64 解码失败: {error}"));
            AppError::validation("导出文件内容无效")
        })?;
    if bytes.len() > MAX_EXPORT_FILE_BYTES {
        return Err(AppError::validation("导出文件过大（最大 128 MB）"));
    }
    if path.exists() && !input.overwrite {
        return Err(AppError::validation("文件已存在"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::validation("导出位置无效"))?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::validation("导出文件名无效"))?;
    let temp_path = parent.join(format!(".{file_name}.tmp-{}", crate::utils::now_ms()));
    fs::write(&temp_path, &bytes)?;
    if let Err(error) = fs::rename(&temp_path, &path) {
        if input.overwrite && path.exists() {
            fs::remove_file(&path)?;
            fs::rename(&temp_path, &path)?;
        } else {
            let _ = fs::remove_file(&temp_path);
            return Err(error.into());
        }
    }
    let kind = if file_name.ends_with(".png") || file_name.ends_with(".svg") {
        "board-image"
    } else if file_name.ends_with(".excalidraw") {
        "board"
    } else {
        "file"
    };
    logging::info(
        "export",
        &format!(
            "写入导出文件 kind={} bytes={} file={}",
            kind,
            bytes.len(),
            file_name
        ),
    );
    Ok(ExportFileDto {
        path: db::paths::path_to_string(&path)?,
        kind: kind.to_string(),
    })
}

fn export_unreferenced_attachments(
    context: &AttachmentContext,
    referenced: &BTreeSet<String>,
    root: &Path,
    result: &mut ExportResult,
) -> AppResult<()> {
    let attachments = attachment_service::list(context, &AttachmentListQuery::default())?;
    for attachment in attachments {
        if referenced.contains(&attachment.id) {
            continue;
        }
        let mut target_dir = root.join("_attachments");
        for component in attachment
            .logical_path
            .split('/')
            .filter(|part| !part.is_empty())
        {
            target_dir = target_dir.join(safe_component(component, "目录"));
        }
        fs::create_dir_all(&target_dir)?;
        let mut used = HashSet::new();
        let name = unique_name(
            &target_dir,
            &safe_component(&attachment.name, "附件"),
            &mut used,
        );
        let path = target_dir.join(name);
        if let Err(error) = copy_attachment(context, &attachment, &path) {
            result
                .warnings
                .push(format!("附件「{}」导出失败：{error}", attachment.name));
            continue;
        }
        result.attachment_count += 1;
        result.files.push(ExportFileDto {
            path: db::paths::path_to_string(&path)?,
            kind: "attachment".to_string(),
        });
    }
    Ok(())
}

struct Prepared {
    ctx: RenderContext,
    files: Vec<ExportFileDto>,
}

#[allow(clippy::too_many_arguments)]
fn prepare_render(
    context: &AttachmentContext,
    document: &Value,
    title: &str,
    attach_dir: &Path,
    rel_prefix: &str,
    used: &mut HashSet<String>,
    warnings: &mut Vec<String>,
) -> AppResult<Prepared> {
    let mut document = document.clone();
    let mut attachment_ids = BTreeSet::new();
    collect_attachment_ids(&document, &mut attachment_ids);
    let mut attachments = BTreeMap::new();
    let mut files = Vec::new();
    let mut images = BTreeMap::new();

    for id in attachment_ids {
        let meta = match attachment_service::get(context, &id) {
            Ok(meta) => meta,
            Err(_) => {
                warnings.push(format!("附件 {id} 不存在或已删除，已保留原引用"));
                continue;
            }
        };
        let name = unique_name(attach_dir, &safe_component(&meta.name, "附件"), used);
        let path = attach_dir.join(&name);
        if let Err(error) = copy_attachment(context, &meta, &path) {
            warnings.push(format!("附件「{}」导出失败：{error}", meta.name));
            continue;
        }
        let rel_path = format!("{rel_prefix}/{name}");
        let embeddable = matches!(
            meta.mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp"
        );
        let bytes = if embeddable && meta.size <= 20 * 1024 * 1024 {
            attachment_service::read_bytes(context, &id).ok()
        } else {
            None
        };
        if let Some(bytes) = &bytes {
            images.insert(rel_path.clone(), bytes.clone());
        }
        files.push(ExportFileDto {
            path: db::paths::path_to_string(&path)?,
            kind: "attachment".to_string(),
        });
        attachments.insert(
            id,
            RenderAttachment {
                name,
                rel_path,
                bytes,
            },
        );
    }

    rewrite_data_images(
        &mut document,
        attach_dir,
        rel_prefix,
        used,
        &mut images,
        &mut files,
        warnings,
    )?;

    Ok(Prepared {
        ctx: RenderContext {
            title: title.to_string(),
            document,
            attachments,
            images,
            warnings: warnings.clone(),
        },
        files,
    })
}

fn write_document(
    ctx: &RenderContext,
    format: ExportFormat,
    path: &Path,
    files: &mut Vec<ExportFileDto>,
) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    match format {
        ExportFormat::Markdown => fs::write(path, export_render::render_markdown(ctx))?,
        ExportFormat::Html => fs::write(path, export_render::render_html(ctx))?,
        ExportFormat::Docx => export_render::render_docx(ctx, path)?,
        ExportFormat::Pdf => export_render::render_pdf(ctx, path)?,
    }
    files.push(ExportFileDto {
        path: db::paths::path_to_string(path)?,
        kind: "document".to_string(),
    });
    Ok(())
}

fn copy_attachment(
    context: &AttachmentContext,
    meta: &AttachmentDto,
    path: &Path,
) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    attachment_service::download(
        context,
        DownloadAttachmentInput {
            id: meta.id.clone(),
            dest_path: db::paths::path_to_string(path)?,
            overwrite: true,
        },
    )?;
    Ok(())
}

fn collect_attachment_ids(node: &Value, out: &mut BTreeSet<String>) {
    let node_type = node.get("type").and_then(Value::as_str).unwrap_or_default();
    match node_type {
        "attachmentImage" => {
            if let Some(id) = node
                .get("attrs")
                .and_then(|attrs| attrs.get("attachmentId"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                out.insert(id.to_string());
            }
        }
        "attachmentBlock" => {
            if let Some(id) = node
                .get("attrs")
                .and_then(|attrs| attrs.get("attachmentId"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            {
                out.insert(id.to_string());
            }
            if let Some(items) = node
                .get("attrs")
                .and_then(|attrs| attrs.get("items"))
                .and_then(Value::as_array)
            {
                for item in items {
                    if let Some(id) = item
                        .get("attachmentId")
                        .and_then(Value::as_str)
                        .filter(|id| !id.is_empty())
                    {
                        out.insert(id.to_string());
                    }
                }
            }
        }
        _ => {}
    }
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            collect_attachment_ids(child, out);
        }
    }
}

fn rewrite_data_images(
    node: &mut Value,
    attach_dir: &Path,
    rel_prefix: &str,
    used: &mut HashSet<String>,
    images: &mut BTreeMap<String, Vec<u8>>,
    files: &mut Vec<ExportFileDto>,
    warnings: &mut Vec<String>,
) -> AppResult<()> {
    if node.get("type").and_then(Value::as_str) == Some("image")
        && let Some(src) = node
            .get("attrs")
            .and_then(|attrs| attrs.get("src"))
            .and_then(Value::as_str)
            .filter(|src| src.starts_with("data:"))
        && let Some((ext, bytes)) = export_render::decode_data_url(src)
    {
        let base = format!("image-{}", images.len() + 1);
        let name = unique_name(attach_dir, &format!("{base}.{ext}"), used);
        let path = attach_dir.join(&name);
        fs::write(&path, &bytes)?;
        let rel_path = format!("{rel_prefix}/{name}");
        images.insert(rel_path.clone(), bytes);
        files.push(ExportFileDto {
            path: db::paths::path_to_string(&path)?,
            kind: "attachment".to_string(),
        });
        if let Some(attrs) = node.get_mut("attrs").and_then(Value::as_object_mut) {
            attrs.insert("src".to_string(), Value::String(rel_path));
        } else {
            warnings.push("内嵌图片缺少 attrs，未能改写路径".to_string());
        }
    }
    if let Some(children) = node.get_mut("content").and_then(Value::as_array_mut) {
        for child in children {
            rewrite_data_images(child, attach_dir, rel_prefix, used, images, files, warnings)?;
        }
    }
    Ok(())
}

fn build_tree(nodes: &[NodeDto]) -> Value {
    fn children_of(nodes: &[NodeDto], parent: Option<&str>) -> Vec<Value> {
        nodes
            .iter()
            .filter(|node| node.parent_id.as_deref() == parent)
            .map(|node| {
                json!({
                    "id": node.id,
                    "title": node.title,
                    "type": node.node_type,
                    "kind": node_kind(node.node_type),
                    "children": children_of(nodes, Some(&node.id)),
                })
            })
            .collect()
    }
    Value::Array(children_of(nodes, None))
}

fn node_kind(node_type: i64) -> &'static str {
    match node_type {
        1 => "folder",
        2 => "doc",
        3 => "board",
        6 => "attachment",
        7 => "mindmap",
        _ => "unknown",
    }
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

fn safe_component(raw: &str, fallback: &str) -> String {
    let replaced: String = raw
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = replaced.trim().trim_matches('.').trim();
    let value = if trimmed.is_empty() {
        fallback
    } else {
        trimmed
    };
    value.chars().take(120).collect()
}

fn unique_directory(dir: &Path, desired: &str, used: &mut HashSet<String>) -> String {
    unique_name(dir, desired, used)
}

fn unique_file_stem(dir: &Path, desired: &str, ext: &str, used: &mut HashSet<String>) -> String {
    for index in 1..10_000 {
        let candidate = if index == 1 {
            desired.to_string()
        } else {
            format!("{desired} ({index})")
        };
        let file_name = format!("{candidate}.{ext}");
        if !used.contains(&file_name) && !dir.join(&file_name).exists() {
            used.insert(file_name);
            return candidate;
        }
    }
    format!("{desired}-{}", crate::utils::now_ms())
}

fn unique_name(dir: &Path, desired: &str, used: &mut HashSet<String>) -> String {
    let path = Path::new(desired);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or(desired);
    let extension = path.extension().and_then(|s| s.to_str());
    for index in 1..10_000 {
        let candidate = if index == 1 {
            desired.to_string()
        } else if let Some(extension) = extension {
            format!("{stem} ({index}).{extension}")
        } else {
            format!("{stem} ({index})")
        };
        if !used.contains(&candidate) && !dir.join(&candidate).exists() {
            used.insert(candidate.clone());
            return candidate;
        }
    }
    format!("{stem}-{}", crate::utils::now_ms())
}
