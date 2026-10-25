//! 组件库与库内组件的 SQL 访问。

use rusqlite::{Connection, OptionalExtension};

use crate::models::library::{LibraryDto, LibraryItemDto, LibrarySourceType};

/// 组件库行。
pub struct LibraryRow {
    pub id: String,
    pub name: String,
    pub author: String,
    pub license: String,
    pub source_url: String,
    pub source_type: String,
    pub enabled: bool,
    pub item_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl LibraryRow {
    /// 转前端 DTO；未知来源类型按导入库展示。
    pub fn to_dto(&self) -> LibraryDto {
        LibraryDto {
            id: self.id.clone(),
            name: self.name.clone(),
            author: self.author.clone(),
            license: self.license.clone(),
            source_url: self.source_url.clone(),
            source_type: LibrarySourceType::from_db(&self.source_type)
                .unwrap_or(LibrarySourceType::Import),
            enabled: self.enabled,
            item_count: self.item_count,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// 列出全部库，预设在前。
pub fn list(connection: &Connection) -> rusqlite::Result<Vec<LibraryRow>> {
    let mut statement = connection.prepare(
        "SELECT id, name, author, license, source_url, source_type,
                enabled, item_count, created_at, updated_at
         FROM board_library
         ORDER BY (source_type = 'preset') DESC, created_at, name",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(LibraryRow {
            id: row.get(0)?,
            name: row.get(1)?,
            author: row.get(2)?,
            license: row.get(3)?,
            source_url: row.get(4)?,
            source_type: row.get(5)?,
            enabled: row.get::<_, i64>(6)? != 0,
            item_count: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

/// 按 id 查询库。
pub fn find(connection: &Connection, id: &str) -> rusqlite::Result<Option<LibraryRow>> {
    connection
        .query_row(
            "SELECT id, name, author, license, source_url, source_type,
                    enabled, item_count, created_at, updated_at
             FROM board_library WHERE id = ?1",
            [id],
            |row| {
                Ok(LibraryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    author: row.get(2)?,
                    license: row.get(3)?,
                    source_url: row.get(4)?,
                    source_type: row.get(5)?,
                    enabled: row.get::<_, i64>(6)? != 0,
                    item_count: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
}

/// 已存在的预设 key，用于避免重复 seed。
pub fn preset_keys(connection: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut statement =
        connection.prepare("SELECT preset_key FROM board_library WHERE preset_key IS NOT NULL")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

/// 新建库的字段集合；避免插入函数参数列表过长。
pub struct NewLibrary<'a> {
    pub id: &'a str,
    pub preset_key: Option<&'a str>,
    pub name: &'a str,
    pub author: &'a str,
    pub license: &'a str,
    pub source_url: &'a str,
    pub source_type: LibrarySourceType,
    pub enabled: bool,
    pub item_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 插入库。
pub fn insert_library(connection: &Connection, library: &NewLibrary<'_>) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO board_library
         (id, preset_key, name, author, license, source_url, source_type,
          enabled, item_count, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            library.id,
            library.preset_key,
            library.name,
            library.author,
            library.license,
            library.source_url,
            library.source_type.as_db(),
            if library.enabled { 1 } else { 0 },
            library.item_count,
            library.created_at,
            library.updated_at
        ],
    )?;
    Ok(())
}

/// 插入库内组件。
pub fn insert_item(
    connection: &Connection,
    id: &str,
    library_id: &str,
    name: &str,
    elements_json: &str,
    sort_order: i64,
    created_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO board_library_item
         (id, library_id, name, elements_json, sort_order, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, library_id, name, elements_json, sort_order, created_at],
    )?;
    Ok(())
}

/// 启用/禁用。
pub fn set_enabled(
    connection: &Connection,
    id: &str,
    enabled: bool,
    updated_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE board_library SET enabled = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, if enabled { 1 } else { 0 }, updated_at],
    )
}

/// 删除库；外键级联删除 items。
pub fn delete(connection: &Connection, id: &str) -> rusqlite::Result<usize> {
    connection.execute("DELETE FROM board_library WHERE id = ?1", [id])
}

/// 读取启用库的全部组件，按库、排序号升序。
pub fn enabled_items(connection: &Connection) -> rusqlite::Result<Vec<LibraryItemDto>> {
    let mut statement = connection.prepare(
        "SELECT item.id, item.name, item.elements_json, item.created_at
         FROM board_library_item item
         JOIN board_library library ON library.id = item.library_id
         WHERE library.enabled = 1
         ORDER BY library.created_at, library.id, item.sort_order, item.created_at",
    )?;
    let rows = statement.query_map([], |row| {
        let elements_json: String = row.get(2)?;
        let elements = serde_json::from_str(&elements_json).unwrap_or(serde_json::Value::Null);
        Ok(LibraryItemDto {
            id: row.get(0)?,
            name: row.get(1)?,
            status: "unpublished".to_string(),
            elements,
            created: row.get(3)?,
        })
    })?;
    rows.collect()
}

/// 某库的组件数量。
pub fn item_count(connection: &Connection, library_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM board_library_item WHERE library_id = ?1",
        [library_id],
        |row| row.get(0),
    )
}
