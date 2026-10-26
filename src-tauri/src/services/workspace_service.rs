//! 工作区用例：目录初始化、全局注册表、统一连接切换与安全删除。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::db;
use crate::domain::{validate_avatar_color, validate_workspace_name};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::{
    BootstrapDto, CreateWorkspaceInput, DeleteWorkspaceInput, DeleteWorkspaceResult,
    KnowledgeBaseRow, RenameWorkspaceInput, SETTING_CURRENT_WORKSPACE, WorkspaceDto,
    WorkspaceRecord,
};
use crate::repositories::knowledge_base_repository;
use crate::repositories::settings_repository;
use crate::repositories::workspace_repository;
#[cfg(not(test))]
use crate::services::attachment_maintenance_service;
#[cfg(not(test))]
use crate::services::attachment_service::AttachmentContext;
use crate::state::{AppState, WorkspaceSession};
use crate::utils::{new_id, now_ms};

/// 新建工作区默认知识库名称。
const DEFAULT_KB_NAME: &str = "默认知识库";

/// 应用启动 DTO：工作区、当前工作区、全部记忆与默认新建目录。
pub fn bootstrap(state: &AppState) -> AppResult<BootstrapDto> {
    let workspaces = list(state)?;
    let current_workspace = workspaces.iter().find(|item| item.is_current).cloned();
    let memory: BTreeMap<String, String> = {
        let global = state.global()?;
        settings_repository::all(&global)?
    };
    let default_workspace_parent =
        db::paths::path_to_string(&db::paths::default_workspace_parent()?)?;
    Ok(BootstrapDto {
        workspaces,
        current_workspace,
        memory,
        default_workspace_parent,
    })
}

/// 列出已登记工作区，标记当前连接。
pub fn list(state: &AppState) -> AppResult<Vec<WorkspaceDto>> {
    let current_id = state.current_workspace_id()?;
    let global = state.global()?;
    let records = workspace_repository::list(&global)?;
    Ok(records
        .iter()
        .map(|record| record.to_dto(current_id.as_deref()))
        .collect())
}

/// 新建本地工作区：校验目录 → 建固定结构 → 迁移并建默认知识库 → 注册 → 统一切换。
pub fn create(state: &AppState, input: CreateWorkspaceInput) -> AppResult<WorkspaceDto> {
    let name = validate_workspace_name(&input.name)?;
    let avatar_color = validate_avatar_color(&input.avatar_color)?;
    let requested = PathBuf::from(&input.path);
    if !requested.is_absolute() {
        return Err(AppError::validation("请选择有效位置"));
    }

    let root = if requested.exists() {
        if !requested.is_dir() {
            return Err(AppError::validation("请选择文件夹"));
        }
        let canonical = requested.canonicalize()?;
        let stored_path = db::paths::path_to_string(&canonical)?;
        {
            let global = state.global()?;
            if workspace_repository::find_by_path(&global, &stored_path)?.is_some() {
                return Err(AppError::conflict("该文件夹已是工作区"));
            }
        }
        if db::paths::is_valid_workspace(&canonical) {
            return Err(AppError::conflict("该文件夹已是工作区"));
        }
        if !is_effectively_empty(&canonical)? {
            return Err(AppError::conflict("请选择空文件夹"));
        }
        canonical
    } else {
        fs::create_dir_all(&requested)?;
        requested.canonicalize()?
    };

    let stored_path = db::paths::path_to_string(&root)?;
    {
        let global = state.global()?;
        if workspace_repository::find_by_path(&global, &stored_path)?.is_some() {
            return Err(AppError::conflict("该文件夹已是工作区"));
        }
    }

    db::paths::ensure_workspace_layout(&root)?;
    initialize_workspace_database(&root)?;

    let now = now_ms();
    let record = WorkspaceRecord {
        id: new_id(),
        name,
        path: stored_path,
        avatar_color,
        created_at: now,
        updated_at: now,
        last_opened_at: now,
    };
    {
        let global = state.global()?;
        if workspace_repository::find_by_path(&global, &record.path)?.is_some() {
            return Err(AppError::conflict("该文件夹已是工作区"));
        }
        workspace_repository::insert(&global, &record)?;
    }

    match switch_workspace(state, &record.id) {
        Ok(dto) => {
            logging::info(
                "workspace",
                &format!("创建工作区 id={} name={}", record.id, record.name),
            );
            Ok(dto)
        }
        Err(error) => {
            // 注册成功但连接失败：撤销注册，避免列表里出现无法打开的工作区。
            if let Ok(global) = state.global() {
                let _ = workspace_repository::delete(&global, &record.id);
            }
            logging::error("workspace", &format!("创建工作区后切换失败: {error}"));
            Err(error)
        }
    }
}

/// 打开已有工作区：必须包含 `db/workspace.sqlite3`，未登记则自动登记。
pub fn open(state: &AppState, path: &str) -> AppResult<WorkspaceDto> {
    let root = db::paths::canonicalize_existing_workspace(path)?;
    let stored_path = db::paths::path_to_string(&root)?;

    let registered = {
        let global = state.global()?;
        workspace_repository::find_by_path(&global, &stored_path)?
    };
    if let Some(record) = registered {
        return switch_workspace(state, &record.id);
    }

    // 先验证数据库可打开且迁移成功，再写入注册表。
    drop(db::workspace::open(&db::paths::workspace_db_path(&root))?);

    let raw_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("本地工作区");
    let name = validate_workspace_name(raw_name).unwrap_or_else(|_| "本地工作区".to_string());
    let now = now_ms();
    let record = WorkspaceRecord {
        id: new_id(),
        name,
        path: stored_path,
        avatar_color: crate::domain::validate_avatar_color("")?,
        created_at: now,
        updated_at: now,
        last_opened_at: now,
    };

    let workspace_id = {
        let global = state.global()?;
        match workspace_repository::find_by_path(&global, &record.path)? {
            Some(existing) => existing.id,
            None => {
                workspace_repository::insert(&global, &record)?;
                record.id.clone()
            }
        }
    };
    logging::info("workspace", &format!("打开工作区 id={workspace_id}"));
    switch_workspace(state, &workspace_id)
}

/// **唯一工作区连接切换入口**：新建、打开、手动切换与删除后的自动切换都必须经过这里。
///
/// 顺序：读取注册记录 → 打开并迁移工作区库 → 全局事务写最近打开时间与记忆 →
/// 替换当前会话。任何一步失败都不会替换旧连接。
pub fn switch_workspace(state: &AppState, workspace_id: &str) -> AppResult<WorkspaceDto> {
    let record = require_record(state, workspace_id)?;
    let session = WorkspaceSession::open(&record)?;
    let now = now_ms();
    {
        let global = state.global()?;
        let transaction = global.unchecked_transaction()?;
        workspace_repository::touch_opened(&transaction, &record.id, now)?;
        settings_repository::set(&transaction, SETTING_CURRENT_WORKSPACE, &record.id, now)?;
        transaction.commit()?;
    }
    {
        let mut guard = state.workspace()?;
        *guard = Some(session);
    }
    // 测试里不启动后台维护，避免与手写维护断言争抢同一批文件。
    #[cfg(not(test))]
    if let Ok(context) = AttachmentContext::from_state(state) {
        attachment_maintenance_service::spawn_workspace_run(context);
    }
    logging::info(
        "workspace",
        &format!("切换到工作区 id={} name={}", record.id, record.name),
    );
    Ok(record.to_dto(Some(&record.id)))
}

/// 只更新全局注册表中的显示名，不改目录名。
pub fn rename(state: &AppState, input: RenameWorkspaceInput) -> AppResult<WorkspaceDto> {
    let name = validate_workspace_name(&input.name)?;
    let current_id = state.current_workspace_id()?;
    let now = now_ms();
    let updated_record = {
        let global = state.global()?;
        let record = workspace_repository::find_by_id(&global, &input.id)?
            .ok_or_else(|| AppError::not_found("工作区不存在"))?;
        workspace_repository::rename(&global, &input.id, &name, now)?;
        WorkspaceRecord {
            name,
            updated_at: now,
            ..record
        }
    };
    logging::info("workspace", &format!("重命名工作区 id={}", input.id));
    Ok(updated_record.to_dto(current_id.as_deref()))
}

/// 删除工作区；当前工作区会先自动切到最近使用的其他工作区。
///
/// `delete_folder` 为 true 时在关闭连接后删除目录，删除前做根/主目录/符号链接校验。
pub fn delete(state: &AppState, input: DeleteWorkspaceInput) -> AppResult<DeleteWorkspaceResult> {
    let record = require_record(state, &input.id)?;
    let current_id = state.current_workspace_id()?;
    let deleting_current = current_id.as_deref() == Some(input.id.as_str());
    let mut next_workspace = None;
    let mut warning = None;

    if deleting_current {
        let next_candidate = {
            let global = state.global()?;
            workspace_repository::list(&global)?
                .into_iter()
                .find(|candidate| candidate.id != input.id)
        };
        if let Some(candidate) = next_candidate {
            match switch_workspace(state, &candidate.id) {
                Ok(dto) => next_workspace = Some(dto),
                Err(error) => {
                    logging::error("workspace", &format!("删除当前工作区后切换失败: {error}"));
                    clear_current_workspace(state)?;
                    warning =
                        Some("已移除当前工作区，但切换到替代工作区失败，请重新选择".to_string());
                }
            }
        } else {
            clear_current_workspace(state)?;
        }
    }

    {
        let global = state.global()?;
        workspace_repository::delete(&global, &input.id)?;
    }

    let mut folder_removed = false;
    if input.delete_folder {
        let path = Path::new(&record.path);
        if !path.exists() {
            warning = warning.or_else(|| Some("本地文件夹已不存在，无需删除".to_string()));
        } else {
            match db::paths::verify_workspace_deletable(path) {
                Ok(canonical) => match fs::remove_dir_all(&canonical) {
                    Ok(()) => folder_removed = true,
                    Err(error) => {
                        logging::error("workspace", &format!("删除工作区文件夹失败: {error}"));
                        warning = Some(
                            "工作区已从列表移除，但本地文件夹删除失败，请手动清理".to_string(),
                        );
                    }
                },
                Err(error) => {
                    logging::error("workspace", &format!("工作区文件夹未通过删除校验: {error}"));
                    warning = Some(format!("工作区已从列表移除，但未删除本地文件夹：{error}"));
                }
            }
        }
    }

    logging::info(
        "workspace",
        &format!("删除工作区 id={} 删除目录={}", input.id, folder_removed),
    );
    Ok(DeleteWorkspaceResult {
        next_workspace,
        folder_removed,
        warning,
    })
}

/// 启动时按记忆恢复当前工作区；失效则清理记忆并返回 None。
pub fn restore_last_workspace(state: &AppState) -> AppResult<Option<WorkspaceDto>> {
    let remembered = {
        let global = state.global()?;
        settings_repository::get(&global, SETTING_CURRENT_WORKSPACE)?
    };
    let Some(workspace_id) = remembered else {
        return Ok(None);
    };
    match switch_workspace(state, &workspace_id) {
        Ok(dto) => {
            logging::info("workspace", &format!("启动恢复工作区 id={}", dto.id));
            Ok(Some(dto))
        }
        Err(error) => {
            logging::error(
                "workspace",
                &format!("启动恢复工作区失败，已清理记忆: {error}"),
            );
            clear_current_workspace(state)?;
            Ok(None)
        }
    }
}

/// 清空当前连接与“当前工作区”记忆；用于删除最后一个工作区或恢复失败。
pub fn clear_current_workspace(state: &AppState) -> AppResult<()> {
    {
        let mut guard = state.workspace()?;
        *guard = None;
    }
    let global = state.global()?;
    settings_repository::remove(&global, SETTING_CURRENT_WORKSPACE)?;
    logging::info("workspace", "当前工作区连接已清空");
    Ok(())
}

/// 初始化新建工作区的数据库与默认知识库。
fn initialize_workspace_database(root: &Path) -> AppResult<()> {
    let connection = db::workspace::open(&db::paths::workspace_db_path(root))?;
    let now = now_ms();
    let default_kb = KnowledgeBaseRow {
        id: new_id(),
        name: DEFAULT_KB_NAME.to_string(),
        description: String::new(),
        sort_order: 0,
        created_at: now,
        updated_at: now,
    };
    let transaction = connection.unchecked_transaction()?;
    knowledge_base_repository::insert(&transaction, &default_kb)?;
    transaction.commit()?;
    Ok(())
}

/// 读取注册记录；不存在时给出明确错误。
fn require_record(state: &AppState, workspace_id: &str) -> AppResult<WorkspaceRecord> {
    let global = state.global()?;
    workspace_repository::find_by_id(&global, workspace_id)?
        .ok_or_else(|| AppError::not_found("工作区不存在或已被移除"))
}

/// 目录为空判定：macOS 的 `.DS_Store` 视为系统噪音，不阻止创建。
fn is_effectively_empty(path: &Path) -> AppResult<bool> {
    let mut entries = fs::read_dir(path)?;
    Ok(entries.all(|entry| {
        entry
            .ok()
            .map(|item| item.file_name() == ".DS_Store")
            .unwrap_or(false)
    }))
}
