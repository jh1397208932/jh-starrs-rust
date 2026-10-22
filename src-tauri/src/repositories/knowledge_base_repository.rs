//! 工作区库 `knowledge_base` 表访问。

use rusqlite::{Connection, OptionalExtension, Row};

use crate::models::KnowledgeBaseRow;

/// 知识库行 + 非文件夹节点数（列表展示用）。
pub struct KnowledgeBaseWithCount {
    pub row: KnowledgeBaseRow,
    pub doc_count: i64,
}

/// 列出知识库，按排序号与创建时间升序。
pub fn list(connection: &Connection) -> rusqlite::Result<Vec<KnowledgeBaseWithCount>> {
    let mut statement = connection.prepare(
        "SELECT kb.id, kb.name, kb.description, kb.sort_order, kb.created_at, kb.updated_at,
                (SELECT COUNT(*) FROM node n
                 WHERE n.knowledge_base_id = kb.id AND n.type <> 1) AS doc_count
         FROM knowledge_base kb
         ORDER BY kb.sort_order, kb.created_at, kb.id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(KnowledgeBaseWithCount {
            row: map_row(row)?,
            doc_count: row.get(6)?,
        })
    })?;
    rows.collect()
}

/// 按 id 查询知识库。
pub fn find_by_id(connection: &Connection, id: &str) -> rusqlite::Result<Option<KnowledgeBaseRow>> {
    connection
        .query_row(
            "SELECT id, name, description, sort_order, created_at, updated_at
             FROM knowledge_base WHERE id = ?1",
            [id],
            map_row,
        )
        .optional()
}

/// 同工作区下一个排序号（末尾追加）。
pub fn next_sort_order(connection: &Connection) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM knowledge_base",
        [],
        |row| row.get(0),
    )
}

/// 插入知识库。
pub fn insert(connection: &Connection, row: &KnowledgeBaseRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO knowledge_base
            (id, name, description, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            row.id,
            row.name,
            row.description,
            row.sort_order,
            row.created_at,
            row.updated_at,
        ],
    )?;
    Ok(())
}

/// 更新名称、描述与修改时间。
pub fn update(
    connection: &Connection,
    id: &str,
    name: &str,
    description: &str,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE knowledge_base
         SET name = ?2, description = ?3, updated_at = ?4
         WHERE id = ?1",
        rusqlite::params![id, name, description, updated_at],
    )?;
    Ok(())
}

/// 删除知识库；节点由外键级联删除。
pub fn delete(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM knowledge_base WHERE id = ?1", [id])?;
    Ok(())
}

/// 知识库下的节点总数（含文件夹），用于删除结果提示。
pub fn node_count(connection: &Connection, knowledge_base_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM node WHERE knowledge_base_id = ?1",
        [knowledge_base_id],
        |row| row.get(0),
    )
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<KnowledgeBaseRow> {
    Ok(KnowledgeBaseRow {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}
