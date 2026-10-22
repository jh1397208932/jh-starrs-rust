//! 全局工作区数据库：工作区注册表与统一记忆配置。
//!
//! 全局库只保存“有哪些工作区”和用户设置，不保存任何知识库数据。

use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::errors::{AppError, AppResult};
use crate::logging;

/// 全局库结构版本。
const SCHEMA_VERSION: i64 = 1;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS workspaces (
    id             TEXT PRIMARY KEY NOT NULL,
    name           TEXT NOT NULL,
    path           TEXT NOT NULL UNIQUE,
    avatar_color   TEXT NOT NULL DEFAULT 'var(--primary)',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    last_opened_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_last_opened
    ON workspaces(last_opened_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
"#;

/// 打开（必要时创建）全局库并执行迁移。
///
/// @param path `db/starris.db` 的绝对路径
/// @returns 已开启外键与 WAL 的连接
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(path)?;
    configure(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// 连接级 PRAGMA：外键、WAL、忙等待，保证跨进程读写的可预期行为。
fn configure(connection: &Connection) -> AppResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// 按 `PRAGMA user_version` 迁移；版本高于程序支持值时拒绝打开，避免写坏新数据。
fn migrate(connection: &mut Connection) -> AppResult<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        logging::error(
            "db.global",
            &format!("全局库版本 {version} 高于程序支持的 {SCHEMA_VERSION}"),
        );
        return Err(AppError::Internal);
    }
    if version < SCHEMA_VERSION {
        let transaction = connection.transaction()?;
        transaction.execute_batch(SCHEMA)?;
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()?;
        logging::info("db.global", "全局库迁移完成，版本=1");
    }
    Ok(())
}
