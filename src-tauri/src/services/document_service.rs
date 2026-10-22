//! 文档用例：块级内容寻址保存、差量计算与正文加载。
//!
//! 保存全程持有当前工作区互斥（`with_session`），并以单事务提交块树、
//! 内容哈希与节点正文，作为前端单飞保存之外的最终并发保护。

use std::collections::HashSet;

use rusqlite::TransactionBehavior;
use serde_json::{Value, json};

use crate::domain::NodeType;
use crate::domain::block_plan::{self, ExistingBlock};
use crate::domain::document::{count_text_chars, prepare_document};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::SaveDocumentInput;
use crate::models::document::{
    BlockAddDto, BlockNodeDto, DocLoadResult, DocSaveResult, OrderChangeDto,
};
use crate::repositories::document_repository as repository;
use crate::services::document_meta_service::{self, DocMetaPayload};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::{new_id, now_ms};

/// 加载文档正文与块树缓存。
pub fn load(state: &AppState, node_id: &str) -> AppResult<DocLoadResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let node = repository::find_node(connection, node_id)?
            .ok_or_else(|| AppError::not_found("文档不存在"))?;
        require_document(node.node_type)?;
        let parsed = parse_document(&node.content)?;
        let prepared = prepare_document(&parsed)?;
        let normalized = prepared.changed;
        let word_count = if normalized {
            count_text_chars(&prepared.document)
        } else {
            node.word_count
        };
        document_meta_service::backfill_if_missing(
            connection,
            &session.db_path,
            node_id,
            &prepared.document,
            node.update_time,
        )?;
        let tree = repository::list_blocks(connection, node_id)?;
        Ok(DocLoadResult {
            document: prepared.document,
            word_count,
            updated_at: node.update_time,
            tree: tree
                .into_iter()
                .map(|block| BlockNodeDto {
                    id: block.id,
                    hash: block.hash,
                    order: block.order,
                })
                .collect(),
            normalized,
        })
    })
}

/// 保存文档：哈希顶层块 → 差量计划 → 单事务写库 → 返回增量结果。
pub fn save(state: &AppState, input: SaveDocumentInput) -> AppResult<DocSaveResult> {
    with_session(state, |session| {
        let db_path = session.db_path.clone();
        let connection = &mut session.connection;
        let node = repository::find_node(connection, &input.node_id)?
            .ok_or_else(|| AppError::not_found("文档不存在"))?;
        require_document(node.node_type)?;

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
        let updated_at = now_ms();
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

        repository::update_content(
            &transaction,
            &input.node_id,
            &content,
            word_count,
            updated_at,
        )?;
        transaction.commit()?;

        document_meta_service::schedule_write(
            db_path,
            DocMetaPayload::from_document(&input.node_id, &prepared.document, updated_at),
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
        })
    })
}

fn require_document(node_type: i64) -> AppResult<()> {
    if NodeType::from_i64(node_type)? == NodeType::Doc {
        Ok(())
    } else {
        Err(AppError::validation("只有文档节点支持正文存储"))
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
