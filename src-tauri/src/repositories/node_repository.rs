//! 工作区库 `node` 表访问：文件树读取、子树查询与排序号维护。

use rusqlite::{Connection, OptionalExtension, Row};

use crate::models::NodeRow;

/// 子树行的最小字段集（移动/改名时维护 level 与 path）。
pub struct SubtreeRow {
    pub id: String,
    pub level: i64,
    pub path: String,
}

/// 回收站根节点行。
pub struct TrashRow {
    pub id: String,
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    pub node_type: i64,
    pub title: String,
    pub path: String,
    pub deleted_at: i64,
}

/// 按知识库读取全部节点（平表）。排序稳定：层级 → 同级序号 → 创建时间 → id。
pub fn list_by_kb(
    connection: &Connection,
    knowledge_base_id: &str,
) -> rusqlite::Result<Vec<NodeRow>> {
    let mut statement = connection.prepare(
        "SELECT id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
                starred, word_count, create_time, update_time
         FROM node
         WHERE knowledge_base_id = ?1 AND deleted_at IS NULL
         ORDER BY level, sort_order, create_time, id",
    )?;
    let rows = statement.query_map([knowledge_base_id], map_row)?;
    rows.collect()
}

/// 按 id 查询节点。
pub fn find_by_id(connection: &Connection, id: &str) -> rusqlite::Result<Option<NodeRow>> {
    connection
        .query_row(
            "SELECT id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
                    starred, word_count, create_time, update_time
             FROM node WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            map_row,
        )
        .optional()
}

/// 插入节点。
pub fn insert(connection: &Connection, row: &NodeRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO node
            (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
             starred, word_count, create_time, update_time)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        rusqlite::params![
            row.id,
            row.node_type,
            row.title,
            row.knowledge_base_id,
            row.parent_id,
            row.level,
            row.path,
            row.sort_order,
            i64::from(row.starred),
            row.word_count,
            row.create_time,
            row.update_time,
        ],
    )?;
    Ok(())
}

/// 更新标题与 materialized path（文件夹改名后自身 path 变化）。
pub fn update_title(
    connection: &Connection,
    id: &str,
    title: &str,
    path: &str,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET title = ?2, path = ?3, update_time = ?4 WHERE id = ?1",
        rusqlite::params![id, title, path, update_time],
    )?;
    Ok(())
}

/// 更新收藏状态。
pub fn update_starred(
    connection: &Connection,
    id: &str,
    starred: bool,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET starred = ?2, update_time = ?3 WHERE id = ?1",
        rusqlite::params![id, i64::from(starred), update_time],
    )?;
    Ok(())
}

/// 移动后更新节点的父级、层级与路径。
pub fn update_move(
    connection: &Connection,
    id: &str,
    parent_id: Option<&str>,
    level: i64,
    path: &str,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node
         SET parent_id = ?2, level = ?3, path = ?4, update_time = ?5
         WHERE id = ?1",
        rusqlite::params![id, parent_id, level, path, update_time],
    )?;
    Ok(())
}

/// 移动/改名时更新后代节点的层级与路径。
pub fn update_subtree_position(
    connection: &Connection,
    id: &str,
    level: i64,
    path: &str,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET level = ?2, path = ?3, update_time = ?4 WHERE id = ?1",
        rusqlite::params![id, level, path, update_time],
    )?;
    Ok(())
}

/// 更新同级排序号。
pub fn update_sort_order(
    connection: &Connection,
    id: &str,
    sort_order: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET sort_order = ?2 WHERE id = ?1",
        rusqlite::params![id, sort_order],
    )?;
    Ok(())
}

/// 读取以 `root_id` 为根的整棵子树（含自身）；parent_id 索引 + 递归 CTE。
pub fn subtree(connection: &Connection, root_id: &str) -> rusqlite::Result<Vec<SubtreeRow>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE subtree(id, level, path) AS (
             SELECT id, level, path FROM node WHERE id = ?1 AND deleted_at IS NULL
             UNION ALL
             SELECT n.id, n.level, n.path
             FROM node n JOIN subtree s ON n.parent_id = s.id
             WHERE n.deleted_at IS NULL
         )
         SELECT id, level, path FROM subtree",
    )?;
    let rows = statement.query_map([root_id], |row| {
        Ok(SubtreeRow {
            id: row.get(0)?,
            level: row.get(1)?,
            path: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// 某父级下的同级节点 id，按现有排序返回。
pub fn sibling_ids(
    connection: &Connection,
    knowledge_base_id: &str,
    parent_id: Option<&str>,
) -> rusqlite::Result<Vec<String>> {
    let mut statement = connection.prepare(
        "SELECT id FROM node
         WHERE knowledge_base_id = ?1 AND parent_id IS ?2 AND deleted_at IS NULL
         ORDER BY sort_order, create_time, id",
    )?;
    let rows = statement.query_map(rusqlite::params![knowledge_base_id, parent_id], |row| {
        row.get(0)
    })?;
    rows.collect()
}

/// 某同级组当前最大排序号；无子节点返回 None。
pub fn max_sort_order(
    connection: &Connection,
    knowledge_base_id: &str,
    parent_id: Option<&str>,
) -> rusqlite::Result<Option<i64>> {
    connection.query_row(
        "SELECT MAX(sort_order) FROM node
         WHERE knowledge_base_id = ?1 AND parent_id IS ?2 AND deleted_at IS NULL",
        rusqlite::params![knowledge_base_id, parent_id],
        |row| row.get(0),
    )
}

/// 递归统计包含自身的子树节点数。
pub fn count_subtree(connection: &Connection, root_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "WITH RECURSIVE subtree(id) AS (
             SELECT id FROM node WHERE id = ?1 AND deleted_at IS NULL
             UNION ALL
             SELECT n.id FROM node n JOIN subtree s ON n.parent_id = s.id
             WHERE n.deleted_at IS NULL
         )
         SELECT COUNT(*) FROM subtree",
        [root_id],
        |row| row.get(0),
    )
}

/// 判断 `ancestor_id` 是否为 `candidate_id` 的祖先（含自身）。
/// 用于阻止把文件夹拖进自己的后代。
pub fn is_ancestor(
    connection: &Connection,
    candidate_id: &str,
    ancestor_id: &str,
) -> rusqlite::Result<bool> {
    let found: i64 = connection.query_row(
        "WITH RECURSIVE ancestors(id, parent_id) AS (
             SELECT id, parent_id FROM node WHERE id = ?1
             UNION ALL
             SELECT n.id, n.parent_id
             FROM node n JOIN ancestors a ON n.id = a.parent_id
         )
         SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = ?2)",
        rusqlite::params![candidate_id, ancestor_id],
        |row| row.get(0),
    )?;
    Ok(found != 0)
}

/// 删除节点；外键级联删除整棵子树。
pub fn delete(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM node WHERE id = ?1", [id])?;
    Ok(())
}

/// 软删除整棵子树；已删除的后代保留原时间戳。返回本次新标记数量。
pub fn soft_delete_subtree(
    connection: &Connection,
    root_id: &str,
    deleted_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "WITH RECURSIVE victims(id) AS (
             SELECT id FROM node WHERE id = ?1 AND deleted_at IS NULL
             UNION ALL
             SELECT n.id FROM node n JOIN victims v ON n.parent_id = v.id
             WHERE n.deleted_at IS NULL
         )
         UPDATE node SET deleted_at = ?2 WHERE id IN (SELECT id FROM victims)",
        rusqlite::params![root_id, deleted_at],
    )
}

/// 恢复整棵子树；只把仍在回收站中的后代一起恢复。
pub fn restore_subtree(connection: &Connection, root_id: &str) -> rusqlite::Result<usize> {
    connection.execute(
        "WITH RECURSIVE targets(id) AS (
             SELECT id FROM node WHERE id = ?1 AND deleted_at IS NOT NULL
             UNION ALL
             SELECT n.id FROM node n JOIN targets t ON n.parent_id = t.id
             WHERE n.deleted_at IS NOT NULL
         )
         UPDATE node SET deleted_at = NULL WHERE id IN (SELECT id FROM targets)",
        [root_id],
    )
}

/// 读取含已删除节点的整棵子树（恢复后重算路径用）。
pub fn subtree_any(connection: &Connection, root_id: &str) -> rusqlite::Result<Vec<SubtreeRow>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE subtree(id, level, path) AS (
             SELECT id, level, path FROM node WHERE id = ?1
             UNION ALL
             SELECT n.id, n.level, n.path
             FROM node n JOIN subtree s ON n.parent_id = s.id
         )
         SELECT id, level, path FROM subtree",
    )?;
    let rows = statement.query_map([root_id], |row| {
        Ok(SubtreeRow {
            id: row.get(0)?,
            level: row.get(1)?,
            path: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// 回收站根节点：自身已删除，父级不存在或仍在正常树中。
pub fn list_trash_roots(
    connection: &Connection,
    knowledge_base_id: &str,
) -> rusqlite::Result<Vec<TrashRow>> {
    let mut statement = connection.prepare(
        "SELECT n.id, n.knowledge_base_id, n.parent_id, n.type, n.title, n.path, n.deleted_at
         FROM node n
         WHERE n.knowledge_base_id = ?1 AND n.deleted_at IS NOT NULL
           AND (n.parent_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM node p WHERE p.id = n.parent_id AND p.deleted_at IS NOT NULL
           ))
         ORDER BY n.deleted_at DESC, n.title",
    )?;
    let rows = statement.query_map([knowledge_base_id], map_trash_row)?;
    rows.collect()
}

/// 按 id 读取回收站节点。
pub fn find_trash(connection: &Connection, id: &str) -> rusqlite::Result<Option<TrashRow>> {
    connection
        .query_row(
            "SELECT id, knowledge_base_id, parent_id, type, title, path, deleted_at
             FROM node WHERE id = ?1 AND deleted_at IS NOT NULL",
            [id],
            map_trash_row,
        )
        .optional()
}

/// 所有已超过保留期的回收站根节点。
pub fn list_expired_trash_roots(
    connection: &Connection,
    cutoff: i64,
) -> rusqlite::Result<Vec<TrashRow>> {
    let mut statement = connection.prepare(
        "SELECT n.id, n.knowledge_base_id, n.parent_id, n.type, n.title, n.path, n.deleted_at
         FROM node n
         WHERE n.deleted_at IS NOT NULL AND n.deleted_at <= ?1
           AND (n.parent_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM node p WHERE p.id = n.parent_id AND p.deleted_at IS NOT NULL
           ))
         ORDER BY n.deleted_at",
    )?;
    let rows = statement.query_map([cutoff], map_trash_row)?;
    rows.collect()
}

/// 恢复后重建搜索索引所需的节点字段。
pub struct SearchSeedRow {
    pub id: String,
    pub title: String,
    pub content: String,
    pub knowledge_base_id: String,
    pub node_type: i64,
}

/// 读取子树中所有节点（用于恢复后重建索引）。
pub fn subtree_search_rows(
    connection: &Connection,
    root_id: &str,
) -> rusqlite::Result<Vec<SearchSeedRow>> {
    let mut statement = connection.prepare(
        "WITH RECURSIVE subtree(id) AS (
             SELECT id FROM node WHERE id = ?1
             UNION ALL
             SELECT n.id FROM node n JOIN subtree s ON n.parent_id = s.id
         )
         SELECT n.id, n.title, n.content, n.knowledge_base_id, n.type
         FROM node n JOIN subtree s ON s.id = n.id",
    )?;
    let rows = statement.query_map([root_id], |row| {
        Ok(SearchSeedRow {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            knowledge_base_id: row.get(3)?,
            node_type: row.get(4)?,
        })
    })?;
    rows.collect()
}

fn map_trash_row(row: &Row<'_>) -> rusqlite::Result<TrashRow> {
    Ok(TrashRow {
        id: row.get(0)?,
        knowledge_base_id: row.get(1)?,
        parent_id: row.get(2)?,
        node_type: row.get(3)?,
        title: row.get(4)?,
        path: row.get(5)?,
        deleted_at: row.get(6)?,
    })
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<NodeRow> {
    Ok(NodeRow {
        id: row.get(0)?,
        node_type: row.get(1)?,
        title: row.get(2)?,
        knowledge_base_id: row.get(3)?,
        parent_id: row.get(4)?,
        level: row.get(5)?,
        path: row.get(6)?,
        sort_order: row.get(7)?,
        starred: row.get::<_, i64>(8)? != 0,
        word_count: row.get(9)?,
        create_time: row.get(10)?,
        update_time: row.get(11)?,
    })
}
