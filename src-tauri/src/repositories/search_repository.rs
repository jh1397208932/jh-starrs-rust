//! 工作区检索索引：普通表 `search_index` 维护唯一行，FTS5 触发器同步正文索引。

use rusqlite::{Connection, params};

/// 一条检索结果（含正文/片段，服务层决定最终返回）。
#[derive(Debug, Clone)]
pub struct SearchRow {
    pub node_id: String,
    pub title: String,
    pub body: String,
    pub kb_id: String,
    pub kb_name: String,
    pub node_type: i64,
    pub updated_at: i64,
    /// FTS snippet；LIKE/最近列表为空，由服务层截取。
    pub snippet: String,
}

/// 新增或更新节点索引；正文为空时仍索引标题。
pub fn upsert(
    connection: &Connection,
    node_id: &str,
    title: &str,
    body: &str,
    kb_id: &str,
    node_type: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO search_index(node_id, title, body, kb_id, node_type, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(node_id) DO UPDATE SET
             title = excluded.title,
             body = excluded.body,
             kb_id = excluded.kb_id,
             node_type = excluded.node_type,
             updated_at = excluded.updated_at",
        params![node_id, title, body, kb_id, node_type, updated_at],
    )?;
    Ok(())
}

/// 只更新标题与时间，保留正文。
pub fn update_title(
    connection: &Connection,
    node_id: &str,
    title: &str,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE search_index SET title = ?2, updated_at = ?3 WHERE node_id = ?1",
        params![node_id, title, updated_at],
    )?;
    Ok(())
}

/// 删除节点子树索引；触发器会同步删除 FTS 行。
pub fn delete_subtree(connection: &Connection, node_id: &str) -> rusqlite::Result<()> {
    connection.execute(
        "DELETE FROM search_index WHERE node_id IN (
             WITH RECURSIVE subtree(id) AS (
                 SELECT id FROM node WHERE id = ?1
                 UNION ALL
                 SELECT n.id FROM node n JOIN subtree s ON n.parent_id = s.id
             )
             SELECT id FROM subtree
         )",
        [node_id],
    )?;
    Ok(())
}

/// 删除知识库全部索引。
pub fn delete_kb(connection: &Connection, kb_id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM search_index WHERE kb_id = ?1", [kb_id])?;
    Ok(())
}

/// 知识网络候选行。
pub struct NetworkRow {
    pub node_id: String,
    pub title: String,
    pub kb_name: String,
    pub node_type: i64,
}

/// 正文提到当前标题的文档（反向链接）。
pub fn query_backlinks(
    connection: &Connection,
    kb_id: &str,
    exclude_id: &str,
    pattern: &str,
    limit: i64,
) -> rusqlite::Result<Vec<NetworkRow>> {
    let mut statement = connection.prepare(
        "SELECT si.node_id, si.title, kb.name, si.node_type
         FROM search_index si
         JOIN node n ON n.id = si.node_id AND n.deleted_at IS NULL
         JOIN knowledge_base kb ON kb.id = si.kb_id
         WHERE si.kb_id = ?1 AND si.node_id <> ?2
           AND si.body LIKE ?3 ESCAPE '\\'
         ORDER BY si.updated_at DESC
         LIMIT ?4",
    )?;
    let rows = statement.query_map(params![kb_id, exclude_id, pattern, limit], |row| {
        Ok(NetworkRow {
            node_id: row.get(0)?,
            title: row.get(1)?,
            kb_name: row.get(2)?,
            node_type: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// 标题或正文提到相似主题的文档（相关推荐）。
pub fn query_related(
    connection: &Connection,
    kb_id: &str,
    exclude_id: &str,
    pattern: &str,
    limit: i64,
) -> rusqlite::Result<Vec<NetworkRow>> {
    let mut statement = connection.prepare(
        "SELECT si.node_id, si.title, kb.name, si.node_type
         FROM search_index si
         JOIN node n ON n.id = si.node_id AND n.deleted_at IS NULL
         JOIN knowledge_base kb ON kb.id = si.kb_id
         WHERE si.kb_id = ?1 AND si.node_id <> ?2
           AND (si.title LIKE ?3 ESCAPE '\\' OR si.body LIKE ?3 ESCAPE '\\')
         ORDER BY (si.title LIKE ?3 ESCAPE '\\') DESC, si.updated_at DESC
         LIMIT ?4",
    )?;
    let rows = statement.query_map(params![kb_id, exclude_id, pattern, limit], |row| {
        Ok(NetworkRow {
            node_id: row.get(0)?,
            title: row.get(1)?,
            kb_name: row.get(2)?,
            node_type: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// FTS5 查询；`match_query` 由服务层完成转义与引号包裹。
pub fn query_fts(
    connection: &Connection,
    kb_id: &str,
    match_query: &str,
    limit: i64,
) -> rusqlite::Result<Vec<SearchRow>> {
    let mut statement = connection.prepare(
        "SELECT s.node_id, s.title, s.body, s.kb_id, COALESCE(kb.name, ''),
                s.node_type, s.updated_at,
                snippet(node_search, 1, '', '', '…', 20)
         FROM node_search
         JOIN search_index s ON s.rowid = node_search.rowid
         LEFT JOIN knowledge_base kb ON kb.id = s.kb_id
         WHERE node_search MATCH ?1 AND s.kb_id = ?2
         ORDER BY bm25(node_search), s.updated_at DESC
         LIMIT ?3",
    )?;
    let rows = statement.query_map(params![match_query, kb_id, limit], map_row)?;
    rows.collect()
}

/// 1–2 字查询回退：对索引表的标题/正文做 LIKE。
pub fn query_like(
    connection: &Connection,
    kb_id: &str,
    pattern: &str,
    limit: i64,
) -> rusqlite::Result<Vec<SearchRow>> {
    let mut statement = connection.prepare(
        "SELECT s.node_id, s.title, s.body, s.kb_id, COALESCE(kb.name, ''),
                s.node_type, s.updated_at, ''
         FROM search_index s
         LEFT JOIN knowledge_base kb ON kb.id = s.kb_id
         WHERE s.kb_id = ?1 AND (s.title LIKE ?2 ESCAPE '\\' OR s.body LIKE ?2 ESCAPE '\\')
         ORDER BY s.updated_at DESC
         LIMIT ?3",
    )?;
    let rows = statement.query_map(params![kb_id, pattern, limit], map_row)?;
    rows.collect()
}

/// 最近更新的节点；空查询的快速跳转使用。
pub fn query_recent(
    connection: &Connection,
    kb_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<SearchRow>> {
    let mut statement = connection.prepare(
        "SELECT s.node_id, s.title, s.body, s.kb_id, COALESCE(kb.name, ''),
                s.node_type, s.updated_at, ''
         FROM search_index s
         LEFT JOIN knowledge_base kb ON kb.id = s.kb_id
         WHERE s.kb_id = ?1
         ORDER BY s.updated_at DESC
         LIMIT ?2",
    )?;
    let rows = statement.query_map(params![kb_id, limit], map_row)?;
    rows.collect()
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchRow> {
    Ok(SearchRow {
        node_id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        kb_id: row.get(3)?,
        kb_name: row.get(4)?,
        node_type: row.get(5)?,
        updated_at: row.get(6)?,
        snippet: row.get(7)?,
    })
}
