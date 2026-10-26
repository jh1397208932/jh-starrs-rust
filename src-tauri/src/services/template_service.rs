//! 模板库：以工作区 `storage/templates/<id>.json` 保存文档/画板快照。
//!
//! 模板是用户可见内容快照，不属于对象存储；文件路径固定在工作区内，随备份一起复制。

use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::board::BoardSaveInput;
use crate::models::template::{
    CreateFromTemplateInput, CreateFromTemplateResult, SaveTemplateInput, TEMPLATE_KIND_BOARD,
    TEMPLATE_KIND_DOC, TemplateFile, TemplateSummary,
};
use crate::models::{CreateNodeInput, SaveDocumentInput};
use crate::services::{board_service, document_service, node_service};
use crate::state::AppState;
use crate::utils::{new_id, now_ms};

const TEMPLATES_DIR: &str = "templates";
const TEMPLATE_VERSION: i64 = 1;

/// 列出当前工作区模板，按创建时间倒序。
pub fn list(state: &AppState) -> AppResult<Vec<TemplateSummary>> {
    let directory = templates_dir(state)?;
    let mut templates = Vec::new();
    let Ok(entries) = fs::read_dir(&directory) else {
        return Ok(templates);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(file) = serde_json::from_str::<TemplateFile>(&raw) else {
            logging::error(
                "template",
                &format!(
                    "模板文件损坏 file={}",
                    path.file_name().and_then(|v| v.to_str()).unwrap_or("?")
                ),
            );
            continue;
        };
        templates.push(TemplateSummary {
            id: file.id,
            name: file.name,
            kind: file.kind,
            created_at: file.created_at,
        });
    }
    templates.sort_by_key(|template| std::cmp::Reverse(template.created_at));
    Ok(templates)
}

/// 把当前文档/画板另存为模板。
pub fn save(state: &AppState, input: SaveTemplateInput) -> AppResult<TemplateSummary> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::validation("模板名称不能为空"));
    }
    let node = node_service::get(state, &input.node_id)?;
    let (kind, content) = match node.node_type {
        2 => {
            let document = document_service::load(state, &node.id)?.document;
            (TEMPLATE_KIND_DOC.to_string(), document)
        }
        3 => {
            let board = board_service::load(state, &node.id)?;
            (
                TEMPLATE_KIND_BOARD.to_string(),
                serde_json::json!({
                    "elements": board.elements,
                    "appState": board.app_state,
                }),
            )
        }
        _ => return Err(AppError::validation("只有文档或画板可以保存为模板")),
    };
    let id = new_id();
    let file = TemplateFile {
        version: TEMPLATE_VERSION,
        id: id.clone(),
        name: name.to_string(),
        kind,
        created_at: now_ms(),
        content,
    };
    let directory = templates_dir(state)?;
    fs::create_dir_all(&directory)?;
    let target = directory.join(format!("{id}.json"));
    let temp = directory.join(format!(".{id}.writing"));
    fs::write(
        &temp,
        serde_json::to_vec_pretty(&file).map_err(|_| AppError::Internal)?,
    )?;
    fs::rename(&temp, &target)?;
    logging::info("template", &format!("保存模板 id={id} kind={}", file.kind));
    Ok(TemplateSummary {
        id: file.id,
        name: file.name,
        kind: file.kind,
        created_at: file.created_at,
    })
}

/// 从模板创建新节点并写入内容。
pub fn create_node(
    state: &AppState,
    input: CreateFromTemplateInput,
) -> AppResult<CreateFromTemplateResult> {
    let file = read_template(state, &input.template_id)?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::validation("名称不能为空"));
    }
    let node_type = match file.kind.as_str() {
        TEMPLATE_KIND_DOC => 2,
        TEMPLATE_KIND_BOARD => 3,
        _ => return Err(AppError::validation("模板类型无效")),
    };
    let node = node_service::create(
        state,
        CreateNodeInput {
            knowledge_base_id: input.knowledge_base_id,
            parent_id: input.parent_id,
            node_type,
            title: title.to_string(),
        },
    )?;
    let result = if node_type == 2 {
        document_service::save(
            state,
            SaveDocumentInput {
                node_id: node.id.clone(),
                document: file.content,
                base_version: 0,
            },
        )
        .map(|_| ())
    } else {
        let elements = file
            .content
            .get("elements")
            .cloned()
            .unwrap_or(Value::Array(Vec::new()));
        let app_state = file
            .content
            .get("appState")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        board_service::save(
            state,
            BoardSaveInput {
                node_id: node.id.clone(),
                base_version: 0,
                elements,
                app_state,
            },
        )
        .map(|_| ())
    };
    if let Err(error) = result {
        let _ = node_service::delete(state, &node.id);
        return Err(error);
    }
    Ok(CreateFromTemplateResult { node })
}

/// 删除模板。
pub fn delete(state: &AppState, id: &str) -> AppResult<()> {
    let path = template_path(state, id)?;
    if path.is_file() {
        fs::remove_file(&path)?;
        logging::info("template", &format!("删除模板 id={id}"));
    }
    Ok(())
}

fn read_template(state: &AppState, id: &str) -> AppResult<TemplateFile> {
    let path = template_path(state, id)?;
    let raw = fs::read_to_string(&path).map_err(|_| AppError::not_found("模板不存在"))?;
    serde_json::from_str(&raw).map_err(|_| AppError::validation("模板文件损坏"))
}

fn template_path(state: &AppState, id: &str) -> AppResult<PathBuf> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(AppError::validation("模板 id 无效"));
    }
    Ok(templates_dir(state)?.join(format!("{id}.json")))
}

fn templates_dir(state: &AppState) -> AppResult<PathBuf> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    Ok(session
        .root_path
        .join(crate::db::paths::WORKSPACE_STORAGE_RELATIVE)
        .join(TEMPLATES_DIR))
}
