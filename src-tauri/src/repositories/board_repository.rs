//! 画板场景与视口的 SQL 访问。

use rusqlite::{Connection, OptionalExtension};

/// 画板节点基础信息。
pub struct BoardNodeRow {
    pub node_type: i64,
    pub update_time: i64,
}

/// 画板场景行。
pub struct BoardSceneRow {
    pub elements_json: String,
    pub app_state_json: String,
    pub scene_version: i64,
    pub updated_at: i64,
}

/// 画板视口行。
pub struct BoardViewportRow {
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub zoom: f64,
}

/// 查询节点类型与更新时间。
pub fn find_node(connection: &Connection, node_id: &str) -> rusqlite::Result<Option<BoardNodeRow>> {
    connection
        .query_row(
            "SELECT type, update_time FROM node WHERE id = ?1 AND deleted_at IS NULL",
            [node_id],
            |row| {
                Ok(BoardNodeRow {
                    node_type: row.get(0)?,
                    update_time: row.get(1)?,
                })
            },
        )
        .optional()
}

/// 查询画板场景；未保存过返回 None。
pub fn find_scene(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<BoardSceneRow>> {
    connection
        .query_row(
            "SELECT elements_json, app_state_json, scene_version, updated_at
             FROM board_scene WHERE node_id = ?1",
            [node_id],
            |row| {
                Ok(BoardSceneRow {
                    elements_json: row.get(0)?,
                    app_state_json: row.get(1)?,
                    scene_version: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()
}

/// 首次插入场景；调用方保证节点与版本正确。
pub fn insert_scene(
    connection: &Connection,
    node_id: &str,
    elements_json: &str,
    app_state_json: &str,
    scene_version: i64,
    element_count: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO board_scene
         (node_id, elements_json, app_state_json, scene_version, element_count, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            node_id,
            elements_json,
            app_state_json,
            scene_version,
            element_count,
            updated_at
        ],
    )?;
    Ok(())
}

/// 更新场景并递增版本；调用方已在事务内校验旧版本。
pub fn update_scene(
    connection: &Connection,
    node_id: &str,
    elements_json: &str,
    app_state_json: &str,
    scene_version: i64,
    element_count: i64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE board_scene
         SET elements_json = ?2, app_state_json = ?3, scene_version = ?4,
             element_count = ?5, updated_at = ?6
         WHERE node_id = ?1",
        rusqlite::params![
            node_id,
            elements_json,
            app_state_json,
            scene_version,
            element_count,
            updated_at
        ],
    )?;
    Ok(())
}

/// 更新节点更新时间，让文件树按最近编辑排序。
pub fn touch_node(connection: &Connection, node_id: &str, updated_at: i64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE node SET update_time = ?2 WHERE id = ?1",
        rusqlite::params![node_id, updated_at],
    )?;
    Ok(())
}

/// 查询视口；未保存过返回 None。
pub fn find_viewport(
    connection: &Connection,
    node_id: &str,
) -> rusqlite::Result<Option<BoardViewportRow>> {
    connection
        .query_row(
            "SELECT scroll_x, scroll_y, zoom FROM board_viewport WHERE node_id = ?1",
            [node_id],
            |row| {
                Ok(BoardViewportRow {
                    scroll_x: row.get(0)?,
                    scroll_y: row.get(1)?,
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
    scroll_x: f64,
    scroll_y: f64,
    zoom: f64,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO board_viewport (node_id, scroll_x, scroll_y, zoom, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(node_id) DO UPDATE SET
             scroll_x = excluded.scroll_x,
             scroll_y = excluded.scroll_y,
             zoom = excluded.zoom,
             updated_at = excluded.updated_at",
        rusqlite::params![node_id, scroll_x, scroll_y, zoom, updated_at],
    )?;
    Ok(())
}
