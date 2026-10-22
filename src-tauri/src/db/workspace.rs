//! 单个本地工作区的 SQLite 数据库：知识库与文件树节点。
//!
//! 每个工作区一个连接、一个文件；切换工作区即替换连接（统一入口见 workspace_service）。

use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::errors::{AppError, AppResult};
use crate::logging;

/// 工作区库结构版本。
const SCHEMA_VERSION: i64 = 4;
/// v1 → v2：节点时间列对齐需求字段名 `create_time/update_time`。
const MIGRATION_V1_TO_V2: &str = r#"
ALTER TABLE node RENAME COLUMN created_at TO create_time;
ALTER TABLE node RENAME COLUMN updated_at TO update_time;
"#;
/// v2 → v3：文档顶层块内容寻址表与块顺序树。
///
/// `"order"` 为 SQL 关键字，建表与查询统一加双引号。
const MIGRATION_V2_TO_V3: &str = r#"
CREATE TABLE IF NOT EXISTS doc_block_hash (
    hash TEXT PRIMARY KEY NOT NULL,
    json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_block_tree (
    id      TEXT PRIMARY KEY NOT NULL,
    node_id TEXT NOT NULL,
    hash    TEXT NOT NULL,
    "order" TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE,
    FOREIGN KEY (hash) REFERENCES doc_block_hash(hash)
);
CREATE INDEX IF NOT EXISTS idx_doc_block_tree_node_order
    ON doc_block_tree(node_id, "order");
CREATE INDEX IF NOT EXISTS idx_doc_block_tree_hash
    ON doc_block_tree(hash);
"#;
/// v3 → v4：每篇文档一行派生元数据（Markdown 文本 + 扩展属性 JSON）。
///
/// 主键直接复用 `node.id`，用外键保证与节点生命周期完全一致。
const MIGRATION_V3_TO_V4: &str = r#"
CREATE TABLE IF NOT EXISTS doc_block_meta (
    id          TEXT PRIMARY KEY NOT NULL,
    markdown    TEXT NOT NULL DEFAULT '',
    prop        TEXT NOT NULL DEFAULT '{}',
    update_time INTEGER NOT NULL,
    FOREIGN KEY (id) REFERENCES node(id) ON DELETE CASCADE
);
"#;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS knowledge_base (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_sort
    ON knowledge_base(sort_order, created_at);

CREATE TABLE IF NOT EXISTS node (
    id                TEXT PRIMARY KEY NOT NULL,
    type              INTEGER NOT NULL CHECK (type BETWEEN 1 AND 5),
    title             TEXT NOT NULL,
    knowledge_base_id TEXT NOT NULL,
    parent_id         TEXT,
    level             INTEGER NOT NULL CHECK (level >= 1),
    path              TEXT NOT NULL,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    starred           INTEGER NOT NULL DEFAULT 0,
    word_count        INTEGER NOT NULL DEFAULT 0,
    content           TEXT NOT NULL DEFAULT '',
    create_time       INTEGER NOT NULL,
    update_time       INTEGER NOT NULL,
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES node(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_node_kb_parent_sort
    ON node(knowledge_base_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_node_parent
    ON node(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_kb
    ON node(knowledge_base_id);

CREATE TABLE IF NOT EXISTS doc_block_hash (
    hash TEXT PRIMARY KEY NOT NULL,
    json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_block_tree (
    id      TEXT PRIMARY KEY NOT NULL,
    node_id TEXT NOT NULL,
    hash    TEXT NOT NULL,
    "order" TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE,
    FOREIGN KEY (hash) REFERENCES doc_block_hash(hash)
);
CREATE INDEX IF NOT EXISTS idx_doc_block_tree_node_order
    ON doc_block_tree(node_id, "order");
CREATE INDEX IF NOT EXISTS idx_doc_block_tree_hash
    ON doc_block_tree(hash);

CREATE TABLE IF NOT EXISTS doc_block_meta (
    id          TEXT PRIMARY KEY NOT NULL,
    markdown    TEXT NOT NULL DEFAULT '',
    prop        TEXT NOT NULL DEFAULT '{}',
    update_time INTEGER NOT NULL,
    FOREIGN KEY (id) REFERENCES node(id) ON DELETE CASCADE
);
"#;

/// 打开（必要时创建）工作区库并执行迁移。
///
/// 调用方负责先确认“打开已有工作区”时数据库文件已存在；本函数会创建文件。
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(path)?;
    configure(&connection)?;
    migrate(&mut connection)?;
    Ok(connection)
}

/// 打开已存在的工作区库，不创建目录或文件，也不执行迁移。
///
/// 供后台派生数据写入与只读校验使用：不切换 journal_mode、不写 user_version，
/// 避免与前台保存事务抢写锁；外键与忙等待仍需按连接设置。
pub fn open_existing(path: &Path) -> AppResult<Connection> {
    if !path.is_file() {
        return Err(AppError::InvalidWorkspace);
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    Ok(connection)
}

/// 连接级 PRAGMA：外键级联删除、WAL、忙等待。
fn configure(connection: &Connection) -> AppResult<()> {
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

/// 按 `PRAGMA user_version` 迁移；不重建已有表，保护用户数据。
fn migrate(connection: &mut Connection) -> AppResult<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        logging::error(
            "db.workspace",
            &format!("工作区库版本 {version} 高于程序支持的 {SCHEMA_VERSION}"),
        );
        return Err(AppError::Internal);
    }
    if version < SCHEMA_VERSION {
        let transaction = connection.transaction()?;
        if version == 0 {
            transaction.execute_batch(SCHEMA)?;
        } else {
            if version == 1 {
                transaction.execute_batch(MIGRATION_V1_TO_V2)?;
            }
            if version <= 2 {
                transaction.execute_batch(MIGRATION_V2_TO_V3)?;
            }
            if version <= 3 {
                transaction.execute_batch(MIGRATION_V3_TO_V4)?;
            }
        }
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()?;
        logging::info(
            "db.workspace",
            &format!("工作区库迁移完成，版本={SCHEMA_VERSION}"),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// v1 旧表的最小结构：只需要时间列用于验证重命名与数据保留。
    const V1_NODE_SCHEMA: &str = r#"
        CREATE TABLE node (
            id         TEXT PRIMARY KEY NOT NULL,
            type       INTEGER NOT NULL,
            title      TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
    "#;

    #[test]
    fn migrates_v1_timestamp_columns_and_keeps_data() {
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        {
            let connection = Connection::open(&path).expect("创建 v1 库");
            connection.execute_batch(V1_NODE_SCHEMA).expect("v1 表");
            connection
                .execute(
                    "INSERT INTO node (id, type, title, created_at, updated_at)
                     VALUES ('n1', 2, '旧数据', 1, 2)",
                    [],
                )
                .expect("写入旧数据");
            connection
                .pragma_update(None, "user_version", 1)
                .expect("写版本");
        }

        let connection = open(&path).expect("迁移打开");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, 4);

        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(node)")
            .expect("表信息")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历列")
            .collect::<Result<_, _>>()
            .expect("列名");
        assert!(columns.contains(&"create_time".to_string()));
        assert!(columns.contains(&"update_time".to_string()));
        assert!(!columns.contains(&"created_at".to_string()));

        let tree_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(doc_block_tree)")
            .expect("块树表")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历块树列")
            .collect::<Result<_, _>>()
            .expect("块树列名");
        assert_eq!(
            tree_columns,
            vec!["id", "node_id", "hash", "order"],
            "v3 必须创建 doc_block_tree"
        );
        connection
            .prepare("SELECT hash, json FROM doc_block_hash LIMIT 0")
            .expect("v3 必须创建 doc_block_hash");

        let meta_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(doc_block_meta)")
            .expect("元数据表")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历元数据列")
            .collect::<Result<_, _>>()
            .expect("元数据列名");
        assert_eq!(
            meta_columns,
            vec!["id", "markdown", "prop", "update_time"],
            "v4 必须创建 doc_block_meta，且主键与 node.id 对齐"
        );

        let title: String = connection
            .query_row("SELECT title FROM node WHERE id = 'n1'", [], |row| {
                row.get(0)
            })
            .expect("旧数据保留");
        assert_eq!(title, "旧数据");
    }
}
