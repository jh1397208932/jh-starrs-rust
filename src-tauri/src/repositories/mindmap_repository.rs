//! 思维导图场景与视口的 SQL 访问。

use rusqlite::{Connection, OptionalExtension};

/// 思维导图节点基础信息。
pub struct MindmapNodeRow {
    pub node_type: i64,
    pub knowledge_base_id: String,
    pub title: String,
    pub update_time: i64,
}

/// 思维导图场景行。
pub struct MindmapSceneRow {
    pub content_json: String,
    pub content_version: i64,
    pub topic_count: i64,
    pub updated_at: i64,
}

/// 思维导图视口行。
pub struct MindmapViewportRow {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// 查询节点类型、标题与更新时间。
pub fn find_node(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<MindmapNodeRow>> {
    connection
        .query_row(
            "SELECT type, knowledge_base_id, title, update_time
             FROM node WHERE id = ?1 AND deleted_at IS NULL",
            [node_id],
            |row| {
                Ok(MindmapNodeRow {
                    node_type: row.get(0)?,
                    knowledge_base_id: row.get(1)?,
                    title: row.get(2)?,
                    update_time: row.get(3)?,
                })
            },
        )
        .optional()
}

/// 查询场景；未保存过返回 None。
pub fn find_scene(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<MindmapSceneRow>> {
    connection
        .query_row(
            "SELECT content_json, content_version, topic_count, updated_at
             FROM mindmap_scene WHERE node_id = ?1",
            [node_id],
            |row| {
                Ok(MindmapSceneRow {
                    content_json: row.get(0)?,
                    content_version: row.get(1)?,
                    topic_count: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
}

/// 首次插入场景。
pub fn insert_scene(
    connection: &Connection,
    node_id: &str,
    content_json: &str,
    topic_count: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO mindmap_scene
         (node_id, content_json, content_version, topic_count, updated_at)
         VALUES (?1, ?2, 1, ?3, ?4)",
        rusqlite::params![node_id, content_json, topic_count, updated_at],
    )?;
    Ok(())
}

/// 更新场景并递增版本；调用方已在事务内校验旧版本。
pub fn update_scene(
    connection: &Connection,
    node_id: &str,
    content_json: &str,
    content_version: i64,
    topic_count: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE mindmap_scene
         SET content_json = ?2, content_version = ?3, topic_count = ?4, updated_at = ?5
         WHERE node_id = ?1",
        rusqlite::params![
            node_id,
            content_json,
            content_version,
            topic_count,
            updated_at
        ],
    )?;
    Ok(())
}

/// 更新节点更新时间与主题数，让文件树按最近编辑排序。
pub fn touch_node(
    connection: &Connection,
    node_id: &str,
    topic_count: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET word_count = ?2, update_time = ?3 WHERE id = ?1",
        rusqlite::params![node_id, topic_count, updated_at],
    )?;
    Ok(())
}

/// 查询视口；未保存过返回 None。
pub fn find_viewport(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<MindmapViewportRow>> {
    connection
        .query_row(
            "SELECT x, y, zoom FROM mindmap_viewport WHERE node_id = ?1",
            [node_id],
            |row| {
                Ok(MindmapViewportRow {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    zoom: row.get(2)?,
                })
            },
        )
        .optional()
}

/// 插入或更新视口；不触碰节点更新时间。
pub fn upsert_viewport(
    connection: &Connection,
    node_id: &str,
    x: f64,
    y: f64,
    zoom: f64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO mindmap_viewport (node_id, x, y, zoom, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(node_id) DO UPDATE SET
             x = excluded.x,
             y = excluded.y,
             zoom = excluded.zoom,
             updated_at = excluded.updated_at",
        rusqlite::params![node_id, x, y, zoom, updated_at],
    )?;
    Ok(())
}
