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

/// 仅建立全局库连接（轻量）：不建表、不迁移；供启动初始化任务使用。
///
/// @param path `db/starris.db` 的绝对路径
/// @returns 已开启外键与 WAL 的连接
pub fn open_connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    configure(&connection)?;
    Ok(connection)
}

/// 打开（必要时创建）并完成全局库初始化。
///
/// 仅测试便捷入口；产品路径在启动装配里按登记任务执行。
#[cfg(test)]
pub fn open(path: &Path) -> AppResult<Connection> {
    let mut connection = open_connection(path)?;
    super::init_registry::run_tasks(&mut connection, super::init_registry::GLOBAL_TASKS)?;
    Ok(connection)
}

/// 初始化任务：按版本号建立/升级全局库结构。
pub(crate) fn task_schema(connection: &mut Connection) -> AppResult<()> {
    migrate(connection)
}

/// 全局库是否需要初始化（版本落后或结构缺失）。
pub fn needs_initialization(connection: &Connection) -> AppResult<bool> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if version < SCHEMA_VERSION {
        return Ok(true);
    }
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('workspaces','settings')",
        [],
        |row| row.get(0),
    )?;
    Ok(count < 2)
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
