//! 节点与附件的引用关系 SQL。
//!
//! `node_attachment` 是业务引用的唯一权威表；文档/画板保存时做差量同步，
//! 节点删除由外键级联清理。物理对象何时可删由 attachment 服务读取本表决定。

use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, params};

use crate::models::attachment::SCOPE_NODE;

/// 一次引用同步的结果。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RefSyncResult {
    pub added: usize,
    pub removed: usize,
    /// 失去最后一个引用的对象 id；调用方据此记录日志或触发维护。
    pub orphaned: Vec<String>,
}

/// 读取某节点当前引用的 object_id。
pub fn list_object_ids(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<BTreeSet<String>> {
    let mut statement =
        connection.prepare("SELECT object_id FROM node_attachment WHERE node_id = ?1")?;
    let rows = statement.query_map([node_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// 统计某对象被多少节点引用。
pub fn count_references(connection: &Connection, object_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
        [object_id],
        |row| row.get(0),
    )
}

/// 插入引用；已存在时只刷新更新时间。返回是否新插入。
pub fn insert_reference(
    connection: &Connection,
    node_id: &str,
    object_id: &str,
    now: i64,
) -> rusqlite::Result<bool> {
    let active = connection
        .query_row(
            "SELECT 1 FROM attachment WHERE id = ?1 AND status = 'active'",
            [object_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !active {
        return Ok(false);
    }
    let inserted = connection.execute(
        "INSERT OR IGNORE INTO node_attachment (node_id, object_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)",
        params![node_id, object_id, now],
    )? > 0;
    connection.execute(
        "UPDATE attachment SET orphaned_at = NULL WHERE id = ?1",
        [object_id],
    )?;
    Ok(inserted)
}

/// 删除引用；若对象已无任何引用且 scope=node，则标记孤儿。
pub fn delete_reference(
    connection: &Connection,
    node_id: &str,
    object_id: &str,
    now: i64,
) -> rusqlite::Result<bool> {
    connection.execute(
        "DELETE FROM node_attachment WHERE node_id = ?1 AND object_id = ?2",
        params![node_id, object_id],
    )?;
    mark_orphan_if_unreferenced(connection, object_id, now)?;
    Ok(count_references(connection, object_id)? == 0)
}

/// 无引用时设置孤儿时间；library 附件保持不标记，交给 TTL/显式操作。
pub fn mark_orphan_if_unreferenced(
    connection: &Connection,
    object_id: &str,
    now: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE attachment
         SET orphaned_at = ?2
         WHERE id = ?1
           AND scope = ?3
           AND status = 'active'
           AND orphaned_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = attachment.id)",
        params![object_id, now, SCOPE_NODE],
    )
}

/// 同步一个节点的完整引用集合。
pub fn sync_node_references(
    connection: &Connection,
    node_id: &str,
    object_ids: &BTreeSet<String>,
    now: i64,
) -> rusqlite::Result<RefSyncResult> {
    let existing = list_object_ids(connection, node_id)?;
    let mut result = RefSyncResult::default();
    for object_id in object_ids.difference(&existing) {
        if insert_reference(connection, node_id, object_id, now)? {
            result.added += 1;
        }
    }
    for object_id in existing.difference(object_ids) {
        let last = delete_reference(connection, node_id, object_id, now)?;
        result.removed += 1;
        if last {
            result.orphaned.push(object_id.clone());
        }
    }
    Ok(result)
}

/// 节点子树内所有 object_id（删除前采集，提交后标记孤儿）。
pub fn object_ids_for_subtree(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<BTreeSet<String>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE subtree(id) AS (
             SELECT id FROM node WHERE id = ?1
             UNION ALL
             SELECT n.id FROM node n JOIN subtree s ON n.parent_id = s.id
         )
         SELECT DISTINCT object_id FROM node_attachment
         WHERE node_id IN (SELECT id FROM subtree)",
    )?;
    let rows = statement.query_map([node_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// 知识库内所有 object_id（删除前采集，提交后标记孤儿）。
pub fn object_ids_for_knowledge_base(
    connection: &Connection,
    knowledge_base_id: &str,
) -> rusqlite::Result<BTreeSet<String>> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT r.object_id
         FROM node_attachment r JOIN node n ON n.id = r.node_id
         WHERE n.knowledge_base_id = ?1",
    )?;
    let rows = statement.query_map([knowledge_base_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// 对一批对象重新检查引用并标记孤儿；返回新标记数量。
pub fn mark_orphans_for(
    connection: &Connection,
    object_ids: &BTreeSet<String>,
    now: i64,
) -> rusqlite::Result<usize> {
    let mut changed = 0;
    for object_id in object_ids {
        changed += mark_orphan_if_unreferenced(connection, object_id, now)?;
    }
    Ok(changed)
}

/// 全量标记无引用的 node 附件（删除后兜底/维护任务使用）。
pub fn mark_all_unreferenced(connection: &Connection, now: i64) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE attachment
         SET orphaned_at = ?1
         WHERE scope = ?2
           AND status = 'active'
           AND orphaned_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = attachment.id)",
        params![now, SCOPE_NODE],
    )
}

/// 查询某节点关联的唯一 object_id（附件节点使用；正常只有一条）。
pub fn first_object_id(connection: &Connection, node_id: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT object_id FROM node_attachment WHERE node_id = ?1 ORDER BY created_at LIMIT 1",
            [node_id],
            |row| row.get(0),
        )
        .optional()
}
