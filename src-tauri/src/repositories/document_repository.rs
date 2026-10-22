//! 工作区库文档块仓储：节点正文、块树与内容哈希表。

use rusqlite::{Connection, OptionalExtension};

/// 保存时需要读取的文档节点字段。
pub struct DocumentNodeRow {
    pub node_type: i64,
    pub content: String,
    pub word_count: i64,
    pub update_time: i64,
}

/// 块树行。
pub struct BlockRow {
    pub id: String,
    pub hash: String,
    pub order: String,
}

/// 查询节点基础字段；不存在返回 None。
pub fn find_node(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<DocumentNodeRow>> {
    connection
        .query_row(
            "SELECT type, content, word_count, update_time FROM node WHERE id = ?1",
            [node_id],
            |row| {
                Ok(DocumentNodeRow {
                    node_type: row.get(0)?,
                    content: row.get(1)?,
                    word_count: row.get(2)?,
                    update_time: row.get(3)?,
                })
            },
        )
        .optional()
}

/// 更新正文缓存、字数与编辑时间。
pub fn update_content(
    connection: &Connection,
    node_id: &str,
    content: &str,
    word_count: i64,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET content = ?2, word_count = ?3, update_time = ?4 WHERE id = ?1",
        rusqlite::params![node_id, content, word_count, update_time],
    )?;
    Ok(())
}

/// 读取文档块树，按 Fractional Index 排序。
pub fn list_blocks(connection: &Connection, node_id: &str) -> rusqlite::Result<Vec<BlockRow>> {
    let mut statement = connection.prepare(
        "SELECT id, hash, \"order\" FROM doc_block_tree
         WHERE node_id = ?1
         ORDER BY \"order\", id",
    )?;
    let rows = statement.query_map([node_id], |row| {
        Ok(BlockRow {
            id: row.get(0)?,
            hash: row.get(1)?,
            order: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// hash 是否已存在于工作区内容表。
pub fn hash_exists(connection: &Connection, hash: &str) -> rusqlite::Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM doc_block_hash WHERE hash = ?1)",
        [hash],
        |row| row.get(0),
    )
}

/// 读取已存 hash 的规范化 JSON（用于碰撞检测）。
pub fn hash_json(connection: &Connection, hash: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT json FROM doc_block_hash WHERE hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()
}

/// 插入内容哈希；已存在时忽略。
pub fn insert_hash(connection: &Connection, hash: &str, json: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR IGNORE INTO doc_block_hash (hash, json) VALUES (?1, ?2)",
        rusqlite::params![hash, json],
    )?;
    Ok(())
}

/// 某 hash 在块树中的引用数。
pub fn reference_count(connection: &Connection, hash: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM doc_block_tree WHERE hash = ?1",
        [hash],
        |row| row.get(0),
    )
}

/// 删除内容哈希；调用方必须先确认引用数为 0。
pub fn delete_hash(connection: &Connection, hash: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM doc_block_hash WHERE hash = ?1", [hash])?;
    Ok(())
}

/// 插入块实例。
pub fn insert_block(
    connection: &Connection,
    id: &str,
    node_id: &str,
    hash: &str,
    order: &str,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO doc_block_tree (id, node_id, hash, \"order\") VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, node_id, hash, order],
    )?;
    Ok(())
}

/// 更新块实例排序键。
pub fn update_block_order(connection: &Connection, id: &str, order: &str) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE doc_block_tree SET \"order\" = ?2 WHERE id = ?1",
        rusqlite::params![id, order],
    )?;
    Ok(())
}

/// 删除块实例。
pub fn delete_block(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM doc_block_tree WHERE id = ?1", [id])?;
    Ok(())
}

/// 读取元数据；不存在返回 None。
pub fn find_meta(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<(String, String, i64)>> {
    connection
        .query_row(
            "SELECT markdown, prop, update_time FROM doc_block_meta WHERE id = ?1",
            [node_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
}

/// 写入或更新派生元数据；主键与 node.id 完全一致。
pub fn upsert_meta(
    connection: &Connection,
    node_id: &str,
    markdown: &str,
    prop: &str,
    update_time: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO doc_block_meta (id, markdown, prop, update_time)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
             markdown = excluded.markdown,
             prop = excluded.prop,
             update_time = excluded.update_time
         WHERE excluded.update_time >= doc_block_meta.update_time",
        rusqlite::params![node_id, markdown, prop, update_time],
    )?;
    Ok(())
}
