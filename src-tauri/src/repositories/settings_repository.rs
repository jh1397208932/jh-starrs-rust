//! 全局库 `settings` 表：统一记忆配置的持久化。

use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension};

/// 读取单个配置值。
pub fn get(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
            row.get(0)
        })
        .optional()
}

/// 读取全部配置，按 key 排序，便于前端一次性加载。
pub fn all(connection: &Connection) -> rusqlite::Result<BTreeMap<String, String>> {
    let mut statement = connection.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut result = BTreeMap::new();
    for row in rows {
        let (key, value) = row?;
        result.insert(key, value);
    }
    Ok(result)
}

/// 写入单个配置（upsert）。
pub fn set(
    connection: &Connection,
    key: &str,
    value: &str,
    updated_at: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value, updated_at],
    )?;
    Ok(())
}

/// 批量写入配置；单事务保证主题与明暗同时生效。
pub fn set_many(
    connection: &Connection,
    entries: &BTreeMap<String, String>,
    updated_at: i64,
) -> rusqlite::Result<()> {
    let transaction = connection.unchecked_transaction()?;
    {
        let mut statement = transaction.prepare(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )?;
        for (key, value) in entries {
            statement.execute(rusqlite::params![key, value, updated_at])?;
        }
    }
    transaction.commit()
}

/// 删除单个配置（例如当前工作区已不存在时清理记忆）。
pub fn remove(connection: &Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM settings WHERE key = ?1", [key])?;
    Ok(())
}
