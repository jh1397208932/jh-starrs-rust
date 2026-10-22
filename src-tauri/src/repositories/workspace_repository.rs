//! 全局库 `workspaces` 表访问。

use rusqlite::{Connection, OptionalExtension, Row};

use crate::models::WorkspaceRecord;

/// 查询全部工作区，按最近打开时间倒序。
pub fn list(connection: &Connection) -> rusqlite::Result<Vec<WorkspaceRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, name, path, avatar_color, created_at, updated_at, last_opened_at
         FROM workspaces
         ORDER BY last_opened_at DESC, created_at DESC, id DESC",
    )?;
    let rows = statement.query_map([], map_row)?;
    rows.collect()
}

/// 按 id 查询工作区。
pub fn find_by_id(connection: &Connection, id: &str) -> rusqlite::Result<Option<WorkspaceRecord>> {
    connection
        .query_row(
            "SELECT id, name, path, avatar_color, created_at, updated_at, last_opened_at
             FROM workspaces WHERE id = ?1",
            [id],
            map_row,
        )
        .optional()
}

/// 按规范化路径查询工作区。
pub fn find_by_path(
    connection: &Connection,
    path: &str,
) -> rusqlite::Result<Option<WorkspaceRecord>> {
    connection
        .query_row(
            "SELECT id, name, path, avatar_color, created_at, updated_at, last_opened_at
             FROM workspaces WHERE path = ?1",
            [path],
            map_row,
        )
        .optional()
}

/// 插入工作区注册记录。
pub fn insert(connection: &Connection, record: &WorkspaceRecord) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO workspaces
            (id, name, path, avatar_color, created_at, updated_at, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            record.id,
            record.name,
            record.path,
            record.avatar_color,
            record.created_at,
            record.updated_at,
            record.last_opened_at,
        ],
    )?;
    Ok(())
}

/// 只改显示名；目录名与 path 不变（需求：名称存在全局存储中）。
pub fn rename(
    connection: &Connection,
    id: &str,
    name: &str,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE workspaces SET name = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, name, updated_at],
    )?;
    Ok(())
}

/// 记录最近打开时间，用于列表排序与“删除当前后切到最近工作区”。
pub fn touch_opened(connection: &Connection, id: &str, opened_at: i64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE workspaces SET last_opened_at = ?2, updated_at = ?2 WHERE id = ?1",
        rusqlite::params![id, opened_at],
    )?;
    Ok(())
}

/// 从注册表删除工作区；不触碰硬盘目录。
pub fn delete(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
    Ok(())
}

fn map_row(row: &Row<'_>) -> rusqlite::Result<WorkspaceRecord> {
    Ok(WorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        avatar_color: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        last_opened_at: row.get(6)?,
    })
}
