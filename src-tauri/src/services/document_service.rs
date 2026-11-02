//! 文档用例：块级内容寻址保存、差量计算与正文加载。
//!
//! 保存全程持有当前工作区互斥（`with_session`），并以单事务提交块树、
//! 内容哈希与节点正文，作为前端单飞保存之外的最终并发保护。

use std::collections::HashSet;

use rusqlite::TransactionBehavior;
use serde_json::{Value, json};

use crate::domain::NodeType;
use crate::domain::block_plan::{self, ExistingBlock};
use crate::domain::document::{count_text_chars, prepare_document, to_markdown, validate_document};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::SaveDocumentInput;
use crate::models::document::{
    BlockAddDto, BlockNodeDto, DocLoadResult, DocSaveResult, OrderChangeDto,
};
use crate::repositories::document_history_repository;
use crate::repositories::document_repository as repository;
use crate::repositories::search_repository;
use crate::services::attachment_reference_service;
use crate::services::document_meta_service::{self, DocMetaPayload};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::{new_id, now_ms};

/// 单篇文档正文上限；与画板 32 MiB 对齐，避免异常载荷把工作区库撑大。
const MAX_DOCUMENT_BYTES: usize = 32 * 1024 * 1024;

/// 校验正文序列化后的体积；超限直接拒绝，不做截断。
fn ensure_document_size(bytes: usize) -> AppResult<()> {
    if bytes > MAX_DOCUMENT_BYTES {
        return Err(AppError::validation("文档内容过大"));
    }
    Ok(())
}

/// 加载文档正文与块树缓存。
pub fn load(state: &AppState, node_id: &str) -> AppResult<DocLoadResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let node = repository::find_node(connection, node_id)?
            .ok_or_else(|| AppError::not_found("文档不存在"))?;
        require_document(node.node_type)?;
        let parsed = parse_document(&node.content)?;
        // 保存路径已经把正文写成规范形态；加载时只需校验，不再复制整棵树做规范化。
        validate_document(&parsed)?;
        document_meta_service::backfill_if_missing(
            connection,
            &session.db_path,
            node_id,
            &parsed,
            node.update_time,
        )?;
        let tree = repository::list_blocks(connection, node_id)?;
        Ok(DocLoadResult {
            document: parsed,
            word_count: node.word_count,
            updated_at: node.update_time,
            tree: tree
                .into_iter()
                .map(|block| BlockNodeDto {
                    id: block.id,
                    hash: block.hash,
                    order: block.order,
                })
                .collect(),
            version: node.doc_version,
        })
    })
}

/// 保存文档：哈希顶层块 → 差量计划 → 单事务写库 → 返回增量结果。
///
/// 数据库瞬时错误（磁盘抖动、锁抖动）会让整个事务回滚。这类错误先重开一次工作区连接再重试：
/// 长时间运行的连接在外部写入把 WAL/SHM 换掉之后会一直返回 I/O 错误，换连接即可恢复。
/// 永久性错误重试一次也不会改变结果，代价有界（一次事务）；前端仍保留 dirty 状态兜底。
pub fn save(state: &AppState, input: SaveDocumentInput) -> AppResult<DocSaveResult> {
    match save_once(state, &input) {
        Err(AppError::Database) => {
            if let Err(error) = state.reopen_workspace() {
                logging::error("document", &format!("重开工作区连接失败: {error}"));
                return Err(AppError::Database);
            }
            save_once(state, &input)
        }
        result => result,
    }
}

fn save_once(state: &AppState, input: &SaveDocumentInput) -> AppResult<DocSaveResult> {
    with_session(state, |session| {
        let db_path = session.db_path.clone();
        let connection = &mut session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("文档不存在"))?;
        require_document(node.node_type)?;
        if node.doc_version != input.base_version {
            return Err(AppError::conflict("文档已在别处更新，请重新加载"));
        }

        let prepared = prepare_document(&input.document)?;
        let blocks = prepared.blocks;
        let hashes: Vec<String> = blocks.iter().map(|block| block.hash.clone()).collect();
        let existing_rows = repository::list_blocks(connection, &input.node_id)?;
        let existing: Vec<ExistingBlock> = existing_rows
            .iter()
            .map(|row| ExistingBlock {
                id: row.id.clone(),
                hash: row.hash.clone(),
                order: row.order.clone(),
            })
            .collect();
        let candidate_ids: Vec<String> = hashes.iter().map(|_| new_id()).collect();

        let plan =
            block_plan::plan_blocks(&existing, &hashes, &candidate_ids).ok_or_else(|| {
                logging::error(
                    "document",
                    &format!("块排序空间耗尽 node={}", input.node_id),
                );
                AppError::Internal
            })?;

        let word_count = count_text_chars(&prepared.document);
        let content = serde_json::to_string(&prepared.document).map_err(|error| {
            logging::error("document", &format!("文档序列化失败: {error}"));
            AppError::Internal
        })?;
        ensure_document_size(content.len())?;
        let updated_at = now_ms();
        // Markdown 只生成一次：写锁内要写检索索引、提交后还要写后台元数据，两处共用。
        // 放在拿写锁之前生成，缩短写事务持有时间（冲突时多算一次，代价可忽略）。
        let markdown = to_markdown(&prepared.document);
        // 立即拿写锁：保存先读块树再写，若用 DEFERRED 会在后台元数据持有
        // RESERVED 时无法升级事务，SQLite 会立刻返回 BUSY 而不等待 busy_timeout。
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let mut add = Vec::new();
        let mut seen_hashes: HashSet<&str> = HashSet::new();
        for block in &blocks {
            if !seen_hashes.insert(block.hash.as_str()) {
                continue;
            }
            if !repository::hash_exists(&transaction, &block.hash)? {
                repository::insert_hash(&transaction, &block.hash, &block.canonical)?;
                add.push(BlockAddDto {
                    hash: block.hash.clone(),
                    json: block.value.clone(),
                });
            } else if let Some(stored) = repository::hash_json(&transaction, &block.hash)?
                && stored != block.canonical
            {
                logging::error(
                    "document",
                    &format!("内容哈希碰撞 hash={} node={}", block.hash, input.node_id),
                );
                return Err(AppError::conflict("文档内容哈希冲突，请重试"));
            }
        }

        for removed in &plan.removed {
            repository::delete_block(&transaction, &removed.id)?;
        }

        for planned in &plan.nodes {
            match planned.old_order.as_deref() {
                Some(old_order) => {
                    if old_order != planned.order {
                        repository::update_block_order(&transaction, &planned.id, &planned.order)?;
                    }
                }
                None => {
                    repository::insert_block(
                        &transaction,
                        &planned.id,
                        &input.node_id,
                        &planned.hash,
                        &planned.order,
                    )?;
                }
            }
        }

        let mut rm = Vec::new();
        let mut seen_removed: HashSet<&str> = HashSet::new();
        for removed in &plan.removed {
            if seen_removed.insert(removed.hash.as_str())
                && repository::reference_count(&transaction, &removed.hash)? == 0
            {
                repository::delete_hash(&transaction, &removed.hash)?;
                rm.push(removed.hash.clone());
            }
        }

        let version = repository::update_content(
            &transaction,
            &input.node_id,
            &content,
            word_count,
            updated_at,
            input.base_version,
        )?
        .ok_or_else(|| AppError::conflict("文档已在别处更新，请重新加载"))?;
        // 与正文同事务更新检索索引；异步元数据只用于迁移回填，不能依赖它。
        search_repository::upsert(
            &transaction,
            &input.node_id,
            &node.title,
            &markdown,
            &node.knowledge_base_id,
            node.node_type,
            updated_at,
        )?;
        // 10 分钟一份快照；首次保存也保留一份，单篇最多 50 份。
        document_history_repository::maybe_snapshot(
            &transaction,
            &input.node_id,
            &content,
            word_count,
            updated_at,
        )?;
        // 引用同步与正文同事务：保存失败时不能留下指向半份文档的关联。
        attachment_reference_service::sync_document_refs(
            &transaction,
            &input.node_id,
            &prepared.document,
            updated_at,
        )?;
        transaction.commit()?;

        document_meta_service::schedule_write(
            db_path,
            DocMetaPayload::for_save(&input.node_id, markdown, content, updated_at),
        );

        logging::info(
            "document",
            &format!(
                "保存文档 node={} blocks={} add={} rm={} order={} rebalanced={} normalized={}",
                input.node_id,
                plan.nodes.len(),
                add.len(),
                rm.len(),
                plan.order_changes.len(),
                plan.rebalanced,
                prepared.changed
            ),
        );

        Ok(DocSaveResult {
            add,
            rm,
            order: plan
                .order_changes
                .into_iter()
                .map(|change| OrderChangeDto {
                    after: change.after,
                    before: change.before,
                    hash_list: change.hash_list,
                })
                .collect(),
            tree: plan
                .nodes
                .into_iter()
                .map(|node| BlockNodeDto {
                    id: node.id,
                    hash: node.hash,
                    order: node.order,
                })
                .collect(),
            word_count,
            updated_at,
            version,
        })
    })
}

fn require_document(node_type: i64) -> AppResult<()> {
    match NodeType::from_i64(node_type)? {
        NodeType::Doc => Ok(()),
        _ => Err(AppError::validation("只有文档节点支持正文存储")),
    }
}

fn parse_document(content: &str) -> AppResult<Value> {
    if content.trim().is_empty() {
        return Ok(json!({"type": "doc", "content": []}));
    }
    serde_json::from_str(content).map_err(|error| {
        logging::error("document", &format!("正文缓存解析失败: {error}"));
        AppError::Internal
    })
}

/// 在当前工作区会话内执行闭包；无工作区时统一报错。
fn with_session<T>(
    state: &AppState,
    action: impl FnOnce(&mut WorkspaceSession) -> AppResult<T>,
) -> AppResult<T> {
    let mut guard = state.workspace()?;
    let session = guard.as_mut().ok_or(AppError::NoActiveWorkspace)?;
    action(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_size_guard_accepts_limit_and_rejects_above() {
        assert!(ensure_document_size(MAX_DOCUMENT_BYTES).is_ok());
        let error = ensure_document_size(MAX_DOCUMENT_BYTES + 1).expect_err("超限必须拒绝");
        assert_eq!(format!("{error}"), "文档内容过大");
    }
}
