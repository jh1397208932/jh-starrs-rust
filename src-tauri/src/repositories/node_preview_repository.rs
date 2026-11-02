//! 节点预览索引 SQL；只做行映射，业务编排在服务层。

use rusqlite::{Connection, OptionalExtension, params};

use crate::models::node_preview::NodePreviewRow;

const COLUMNS: &str = "node_id, object_id, width, height, source_updated_at, updated_at";

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NodePreviewRow> {
    Ok(NodePreviewRow {
        node_id: row.get(0)?,
        object_id: row.get(1)?,
        width: row.get(2)?,
        height: row.get(3)?,
        source_updated_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

/// 读取某节点的预览索引。
pub fn find(connection: &Connection, node_id: &str) -> rusqlite::Result<Option<NodePreviewRow>> {
    connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM node_preview WHERE node_id = ?1"),
            [node_id],
            map_row,
        )
        .optional()
}

/// 写入/更新预览索引；同一节点只保留一行。
pub fn upsert(connection: &Connection, row: &NodePreviewRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO node_preview
            (node_id, object_id, width, height, source_updated_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(node_id) DO UPDATE SET
            object_id = excluded.object_id,
            width = excluded.width,
            height = excluded.height,
            source_updated_at = excluded.source_updated_at,
            updated_at = excluded.updated_at",
        params![
            row.node_id,
            row.object_id,
            row.width,
            row.height,
            row.source_updated_at,
            row.updated_at
        ],
    )?;
    Ok(())
}
