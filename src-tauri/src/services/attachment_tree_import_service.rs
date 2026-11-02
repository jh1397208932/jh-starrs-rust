//! 附件树导入：把一个本地文件或整棵目录上传到文件树。
//!
//! 单文件上传也走这里，保证「上传对象 → 建附件节点 → 失败回滚」只有一份实现；
//! 目录按层级创建文件夹节点：同名文件夹复用、同名文件自动改名、隐藏项与符号链接跳过。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::models::attachment::{SCOPE_NODE, UploadAttachmentInput};
use crate::models::{CreateAttachmentNodeInput, CreateNodeInput, NodeDto};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::node_service;
use crate::state::AppState;

/// 单次目录导入最多多少个文件。
pub const MAX_FOLDER_FILES: usize = 2000;
/// 单次目录导入的总体积上限（2 GB）。
pub const MAX_FOLDER_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// 目录递归深度上限，避免异常结构或软链造成无限展开。
pub const MAX_FOLDER_DEPTH: usize = 32;

/// 单个文件导入失败的原因，逐条回给界面。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportFailure {
    pub path: String,
    pub message: String,
}

/// 目录导入结果。
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderImportResult {
    pub folders: i64,
    pub files: i64,
    pub skipped: i64,
    pub failures: Vec<FolderImportFailure>,
}

/// 收集到的目录项：相对根目录的路径、是否目录、文件大小。
struct WalkEntry {
    relative: PathBuf,
    is_dir: bool,
    size: u64,
}

/// 上传单个文件为附件节点；节点创建失败时回滚逻辑附件。
///
/// @param state 应用状态（取当前工作区连接）
/// @param kb_id 目标知识库
/// @param parent_id 父节点（目录节点或空表示根）
/// @param source 本地文件路径
/// @param name 覆盖文件名；空用源文件名
/// @param mime 覆盖 MIME；空按扩展名推断
/// @returns 新建的附件节点
pub fn upload_file_as_node(
    state: &AppState,
    kb_id: &str,
    parent_id: Option<&str>,
    source: &Path,
    logical_path: &str,
    name: Option<&str>,
    mime: Option<String>,
) -> AppResult<NodeDto> {
    let context = AttachmentContext::from_state(state)?;
    let fallback = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("附件")
        .to_string();
    let attachment = attachment_service::upload(
        &context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: logical_path.to_string(),
            name: Some(name.unwrap_or(&fallback).to_string()),
            mime,
            scope: Some(SCOPE_NODE.to_string()),
            ttl_seconds: None,
        },
    )?;
    let node = node_service::create_attachment_node(
        state,
        CreateAttachmentNodeInput {
            knowledge_base_id: kb_id.to_string(),
            parent_id: parent_id.map(str::to_string),
            object_id: attachment.id.clone(),
        },
    );
    match node {
        Ok(node) => Ok(node),
        Err(error) => {
            if let Err(cleanup) = attachment_service::delete(&context, &attachment.id) {
                crate::logging::error(
                    "attachment",
                    &format!("附件节点创建失败后清理附件失败: {cleanup}"),
                );
            }
            Err(error)
        }
    }
}

/// 把整个目录上传到指定父节点下，按层级创建文件夹节点。
///
/// @param state 应用状态
/// @param kb_id 目标知识库
/// @param parent_id 挂载位置（空表示根）
/// @param root 本地目录
/// @returns 创建的文件夹数、文件数、跳过数与逐条失败原因
pub fn import_folder(
    state: &AppState,
    kb_id: &str,
    parent_id: Option<&str>,
    root: &Path,
) -> AppResult<FolderImportResult> {
    if !root.is_dir() {
        return Err(AppError::validation("所选路径不是文件夹"));
    }
    let mut entries = Vec::new();
    let mut skipped = 0_i64;
    walk(root, root, 0, &mut entries, &mut skipped)?;

    // 先算清单再动手：护栏不通过时一个节点都不建，避免留下半成品目录树。
    let file_count = entries.iter().filter(|entry| !entry.is_dir).count();
    let total_bytes: u64 = entries
        .iter()
        .filter(|entry| !entry.is_dir)
        .map(|entry| entry.size)
        .sum();
    if file_count > MAX_FOLDER_FILES {
        return Err(AppError::validation(format!(
            "所选文件夹包含 {file_count} 个文件，超过单次 {MAX_FOLDER_FILES} 个的上限，请分批上传"
        )));
    }
    if total_bytes > MAX_FOLDER_BYTES {
        return Err(AppError::validation(
            "所选文件夹超过 2 GB，请分批上传".to_string(),
        ));
    }

    // 现有同层节点索引：同名文件夹复用，同名文件改名。
    let mut folder_index: HashMap<(Option<String>, String), String> = HashMap::new();
    let mut taken_names: HashMap<(Option<String>, String), ()> = HashMap::new();
    for node in node_service::list(state, kb_id)? {
        let key = (node.parent_id.clone(), node.title.clone());
        taken_names.insert(key.clone(), ());
        if node.node_type == 1 {
            folder_index.insert(key, node.id);
        }
    }

    let root_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("导入文件夹")
        .to_string();
    let root_folder = ensure_folder(state, kb_id, parent_id, &root_name, &mut folder_index)?;
    let mut result = FolderImportResult {
        folders: 1,
        skipped,
        ..Default::default()
    };

    // 目录按层级从浅到深创建，保证父节点先存在。
    let mut directories: Vec<&WalkEntry> = entries.iter().filter(|entry| entry.is_dir).collect();
    directories.sort_by(|left, right| {
        left.relative
            .components()
            .count()
            .cmp(&right.relative.components().count())
            .then_with(|| left.relative.cmp(&right.relative))
    });
    let mut folder_ids: HashMap<PathBuf, String> = HashMap::new();
    for entry in directories {
        let title = file_name_of(&entry.relative)?;
        let parent_folder = parent_folder_id(&entry.relative, &root_folder, &folder_ids);
        let folder_id = ensure_folder(
            state,
            kb_id,
            parent_folder.as_deref(),
            &title,
            &mut folder_index,
        )?;
        folder_ids.insert(entry.relative.clone(), folder_id);
        result.folders += 1;
    }

    // 文件按路径排序，逐个上传；失败只记录，不回滚已成功的部分。
    let mut files: Vec<&WalkEntry> = entries.iter().filter(|entry| !entry.is_dir).collect();
    files.sort_by(|left, right| left.relative.cmp(&right.relative));
    for entry in files {
        let source = root.join(&entry.relative);
        let parent_folder = parent_folder_id(&entry.relative, &root_folder, &folder_ids);
        let original = file_name_of(&entry.relative)?;
        let name = unique_name(parent_folder.as_deref(), &original, &taken_names);
        taken_names.insert((parent_folder.clone(), name.clone()), ());
        match upload_file_as_node(
            state,
            kb_id,
            parent_folder.as_deref(),
            &source,
            "",
            Some(&name),
            None,
        ) {
            Ok(_) => result.files += 1,
            Err(error) => result.failures.push(FolderImportFailure {
                path: entry.relative.to_string_lossy().into_owned(),
                message: error.to_string(),
            }),
        }
    }
    Ok(result)
}

/// 递归收集目录项：跳过 `.` 开头的隐藏项与符号链接，超深度的计入跳过数。
fn walk(
    root: &Path,
    current: &Path,
    depth: usize,
    entries: &mut Vec<WalkEntry>,
    skipped: &mut i64,
) -> AppResult<()> {
    let reader = std::fs::read_dir(current)
        .map_err(|error| AppError::validation(format!("无法读取文件夹：{error}")))?;
    for item in reader {
        let item =
            item.map_err(|error| AppError::validation(format!("读取目录项失败：{error}")))?;
        let name = item.file_name();
        let name_text = name.to_string_lossy();
        if name_text.starts_with('.') {
            *skipped += 1;
            continue;
        }
        // file_type 不跟随符号链接：软链一律跳过，避免把外部目录或环带进来。
        let file_type = item
            .file_type()
            .map_err(|error| AppError::validation(format!("读取文件类型失败：{error}")))?;
        if file_type.is_symlink() {
            *skipped += 1;
            continue;
        }
        if depth + 1 > MAX_FOLDER_DEPTH {
            *skipped += 1;
            continue;
        }
        let path = item.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::validation("目录相对路径计算失败"))?
            .to_path_buf();
        if file_type.is_dir() {
            entries.push(WalkEntry {
                relative,
                is_dir: true,
                size: 0,
            });
            walk(root, &path, depth + 1, entries, skipped)?;
        } else if file_type.is_file() {
            let size = item.metadata().map(|meta| meta.len()).unwrap_or(0);
            entries.push(WalkEntry {
                relative,
                is_dir: false,
                size,
            });
        } else {
            *skipped += 1;
        }
    }
    Ok(())
}

fn file_name_of(relative: &Path) -> AppResult<String> {
    relative
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| AppError::validation("文件名无法识别"))
}

/// 目录项所属的文件夹节点 id：根目录下的项挂到根文件夹，其余挂到已创建的同级文件夹。
fn parent_folder_id(
    relative: &Path,
    root_folder: &str,
    folder_ids: &HashMap<PathBuf, String>,
) -> Option<String> {
    let parent = relative
        .parent()
        .filter(|path| !path.as_os_str().is_empty());
    match parent {
        None => Some(root_folder.to_string()),
        Some(path) => folder_ids
            .get(path)
            .cloned()
            .or_else(|| Some(root_folder.to_string())),
    }
}

/// 确保某一层存在同名文件夹节点：已存在则复用，否则新建。
fn ensure_folder(
    state: &AppState,
    kb_id: &str,
    parent_id: Option<&str>,
    title: &str,
    folder_index: &mut HashMap<(Option<String>, String), String>,
) -> AppResult<String> {
    let key = (parent_id.map(str::to_string), title.to_string());
    if let Some(id) = folder_index.get(&key) {
        return Ok(id.clone());
    }
    let node = node_service::create(
        state,
        CreateNodeInput {
            knowledge_base_id: kb_id.to_string(),
            parent_id: parent_id.map(str::to_string),
            node_type: 1,
            title: title.to_string(),
        },
    )?;
    folder_index.insert(key, node.id.clone());
    Ok(node.id)
}

/// 同层同名文件自动改名：`report.pdf` → `report (2).pdf`。
fn unique_name(
    parent_id: Option<&str>,
    original: &str,
    taken: &HashMap<(Option<String>, String), ()>,
) -> String {
    let key = (parent_id.map(str::to_string), original.to_string());
    if !taken.contains_key(&key) {
        return original.to_string();
    }
    let (stem, extension) = match original.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (original, String::new()),
    };
    for index in 2..10_000 {
        let candidate = format!("{stem} ({index}){extension}");
        if !taken.contains_key(&(parent_id.map(str::to_string), candidate.clone())) {
            return candidate;
        }
    }
    original.to_string()
}
