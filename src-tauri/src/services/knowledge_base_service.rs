//! 知识库用例：增删改查；所有操作只作用于当前工作区库。

use rusqlite::Connection;

use crate::domain::{validate_kb_description, validate_kb_name};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::{
    CreateKbInput, DeleteKbResult, KnowledgeBaseDto, KnowledgeBaseRow, UpdateKbInput,
};
use crate::repositories::knowledge_base_repository as repository;
use crate::repositories::node_attachment_repository;
use crate::repositories::search_repository;
use crate::services::attachment_reference_service;
use crate::state::AppState;
use crate::utils::{new_id, now_ms};

/// 列出当前工作区的知识库。
pub fn list(state: &AppState) -> AppResult<Vec<KnowledgeBaseDto>> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let rows = repository::list(&session.connection)?;
    Ok(rows
        .into_iter()
        .map(|entry| entry.row.to_dto(&session.workspace_id, entry.doc_count))
        .collect())
}

/// 按 id 查询当前工作区的知识库。
pub fn get(state: &AppState, id: &str) -> AppResult<KnowledgeBaseDto> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    find_dto(&session.connection, &session.workspace_id, id)
}

/// 新建知识库，追加到末尾。
pub fn create(state: &AppState, input: CreateKbInput) -> AppResult<KnowledgeBaseDto> {
    let name = validate_kb_name(&input.name)?;
    let description = validate_kb_description(&input.description)?;
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let connection = &session.connection;
    let now = now_ms();
    let row = KnowledgeBaseRow {
        id: new_id(),
        name,
        description,
        sort_order: repository::next_sort_order(connection)?,
        created_at: now,
        updated_at: now,
    };
    let transaction = connection.unchecked_transaction()?;
    repository::insert(&transaction, &row)?;
    transaction.commit()?;
    logging::info("kb", &format!("创建知识库 id={}", row.id));
    Ok(row.to_dto(&session.workspace_id, 0))
}

/// 修改知识库名称/描述；未提供的字段保持不变。
pub fn update(state: &AppState, input: UpdateKbInput) -> AppResult<KnowledgeBaseDto> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let connection = &session.connection;
    let existing = repository::find_by_id(connection, &input.id)?
        .ok_or_else(|| AppError::not_found("知识库不存在"))?;
    let name = match input.name {
        Some(raw) => validate_kb_name(&raw)?,
        None => existing.name.clone(),
    };
    let description = match input.description {
        Some(raw) => validate_kb_description(&raw)?,
        None => existing.description.clone(),
    };
    if name != existing.name || description != existing.description {
        repository::update(connection, &existing.id, &name, &description, now_ms())?;
        logging::info("kb", &format!("更新知识库 id={}", existing.id));
    }
    find_dto(connection, &session.workspace_id, &existing.id)
}

/// 删除知识库；级联删除其全部节点。
pub fn delete(state: &AppState, id: &str) -> AppResult<DeleteKbResult> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let connection = &session.connection;
    let existing = repository::find_by_id(connection, id)?
        .ok_or_else(|| AppError::not_found("知识库不存在"))?;
    let deleted_nodes = repository::node_count(connection, &existing.id)?;
    let object_ids =
        node_attachment_repository::object_ids_for_knowledge_base(connection, &existing.id)?;
    let transaction = connection.unchecked_transaction()?;
    search_repository::delete_kb(&transaction, &existing.id)?;
    repository::delete(&transaction, &existing.id)?;
    attachment_reference_service::mark_orphans_for(&transaction, &object_ids, now_ms())?;
    transaction.commit()?;
    logging::info(
        "kb",
        &format!("删除知识库 id={} 节点数={deleted_nodes}", existing.id),
    );
    Ok(DeleteKbResult { deleted_nodes })
}

/// 查询并组装 DTO；不存在时返回 NotFound。
fn find_dto(connection: &Connection, workspace_id: &str, id: &str) -> AppResult<KnowledgeBaseDto> {
    let row = repository::find_by_id(connection, id)?
        .ok_or_else(|| AppError::not_found("知识库不存在"))?;
    let doc_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM node WHERE knowledge_base_id = ?1 AND type NOT IN (1, 6)
           AND deleted_at IS NULL",
        [id],
        |row| row.get(0),
    )?;
    Ok(row.to_dto(workspace_id, doc_count))
}
