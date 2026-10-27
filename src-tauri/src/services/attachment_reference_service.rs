//! 附件引用同步：把文档/画板最终内容映射到 `node_attachment`。
//!
//! 只在保存事务内做 O(引用数) 差量；不扫描全库。失去最后一个引用的 node 附件
//! 会被打上 `orphaned_at`，由维护任务在宽限期后回收。

use rusqlite::Connection;
use serde_json::Value;

use crate::domain::attachment_refs;
use crate::errors::AppResult;
use crate::logging;
use crate::repositories::node_attachment_repository as repository;
use crate::repositories::node_attachment_repository::RefSyncResult;

/// 同步文档引用。
///
/// @param connection 当前保存事务连接
/// @param node_id 文档节点 id
/// @param document 最终文档 JSON
/// @param now 当前时间（Unix 毫秒）
/// @returns 新增/移除/孤儿数量
pub fn sync_document_refs(
    connection: &Connection,
    node_id: &str,
    document: &Value,
    now: i64,
) -> AppResult<RefSyncResult> {
    let object_ids = attachment_refs::collect_document_attachment_ids(document);
    sync(connection, node_id, &object_ids, now)
}

/// 同步画板引用。
///
/// @param connection 当前保存事务连接
/// @param node_id 画板节点 id
/// @param elements 最终 Excalidraw elements
/// @param now 当前时间（Unix 毫秒）
pub fn sync_board_refs(
    connection: &Connection,
    node_id: &str,
    elements: &Value,
    now: i64,
) -> AppResult<RefSyncResult> {
    let object_ids = attachment_refs::collect_board_attachment_ids(elements);
    sync(connection, node_id, &object_ids, now)
}

/// 同步思维导图主题图片引用。
///
/// @param connection 当前保存事务连接
/// @param node_id 思维导图节点 id
/// @param content 最终导图场景
/// @param now 当前时间（Unix 毫秒）
pub fn sync_mindmap_refs(
    connection: &Connection,
    node_id: &str,
    content: &crate::models::mindmap::MindmapContent,
    now: i64,
) -> AppResult<RefSyncResult> {
    let object_ids = crate::domain::mindmap::collect_image_object_ids(content);
    sync(connection, node_id, &object_ids, now)
}

/// 附件节点创建时登记唯一对象引用。
pub fn register_node_object(
    connection: &Connection,
    node_id: &str,
    object_id: &str,
    now: i64,
) -> AppResult<bool> {
    Ok(repository::insert_reference(
        connection, node_id, object_id, now,
    )?)
}

/// 对删除后的对象集合做增量孤儿标记。
pub fn mark_orphans_for(
    connection: &Connection,
    object_ids: &std::collections::BTreeSet<String>,
    now: i64,
) -> AppResult<usize> {
    let changed = repository::mark_orphans_for(connection, object_ids, now)?;
    if changed > 0 {
        logging::info(
            "attachment",
            &format!("附件引用已释放，新增孤儿 {changed} 个"),
        );
    }
    Ok(changed)
}

fn sync(
    connection: &Connection,
    node_id: &str,
    object_ids: &std::collections::BTreeSet<String>,
    now: i64,
) -> AppResult<RefSyncResult> {
    let result = repository::sync_node_references(connection, node_id, object_ids, now)?;
    if result.added > 0 || result.removed > 0 {
        logging::debug(
            "attachment",
            &format!(
                "引用同步 node={node_id} add={} rm={} orphan={}",
                result.added,
                result.removed,
                result.orphaned.len()
            ),
        );
    }
    Ok(result)
}
