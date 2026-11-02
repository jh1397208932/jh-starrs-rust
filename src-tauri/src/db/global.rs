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

/// 仅建立全局库连接（轻量）：不建表；初始化由 [`task_init`] 负责。
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

/// 初始化任务：只在空库上建表；版本不一致直接拒绝（AGENTS.md §9 无历史数据原则）。
pub(crate) fn task_init(connection: &mut Connection) -> AppResult<()> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::from)?;
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version != 0 {
        logging::error(
            "db.global",
            &format!("全局库版本 {version} 与当前 {SCHEMA_VERSION} 不一致，拒绝打开"),
        );
        return Err(AppError::validation(
            "全局库由旧版本创建，本项目不保留历史数据；请删除 db/starris.db 后重新启动",
        ));
    }
    let tables: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if tables > 0 {
        logging::error("db.global", "全局库没有版本号但已存在数据表，拒绝打开");
        return Err(AppError::validation(
            "全局库结构无法识别；请删除 db/starris.db 后重新启动",
        ));
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(SCHEMA)?;
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    logging::info("db.global", "全局库已创建，版本=1");
    Ok(())
}

/// 连接级 PRAGMA：外键、WAL、忙等待，保证跨进程读写的可预期行为。
fn configure(connection: &Connection) -> AppResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_temp(dir: &tempfile::TempDir) -> Connection {
        open_connection(&dir.path().join("db/starris.db")).expect("打开全局库")
    }

    #[test]
    fn fresh_global_database_is_created_once() {
        let dir = tempfile::tempdir().expect("临时目录");
        let mut connection = open_temp(&dir);
        task_init(&mut connection).expect("首次建库");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, SCHEMA_VERSION);
        let tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('workspaces','settings')",
                [],
                |row| row.get(0),
            )
            .expect("数表");
        assert_eq!(tables, 2);
        task_init(&mut connection).expect("重复初始化直接通过");
    }

    #[test]
    fn outdated_global_database_is_rejected() {
        let dir = tempfile::tempdir().expect("临时目录");
        let mut connection = open_temp(&dir);
        connection
            .execute_batch("CREATE TABLE workspaces (id TEXT PRIMARY KEY);")
            .expect("模拟旧库");
        connection
            .pragma_update(None, "user_version", 99_i64)
            .expect("写版本");
        let error = task_init(&mut connection).expect_err("旧版本必须拒绝");
        assert!(
            format!("{error}").contains("不保留历史数据"),
            "错误信息要说明不保留历史数据：{error}"
        );
    }

    #[test]
    fn global_database_without_version_but_with_tables_is_rejected() {
        let dir = tempfile::tempdir().expect("临时目录");
        let mut connection = open_temp(&dir);
        connection
            .execute_batch("CREATE TABLE legacy_thing (id TEXT);")
            .expect("模拟无版本旧库");
        let error = task_init(&mut connection).expect_err("无版本旧库必须拒绝");
        assert!(
            format!("{error}").contains("无法识别"),
            "错误信息要说明结构无法识别：{error}"
        );
    }
}
