//! 工作区库：单一当前 schema，不做版本迁移、不做结构自愈。
//!
//! 约定见 AGENTS.md §9「无历史数据原则」：库结构只在本文件的 [`SCHEMA`] 里演进；
//! 版本号不一致直接拒绝打开，由用户删除旧工作区重建，不在代码里迁移或兼容旧结构。

use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::errors::{AppError, AppResult};
use crate::logging;

/// 工作区库结构版本；修改 [`SCHEMA`] 时同步 +1，旧库一律拒绝打开。
pub(crate) const SCHEMA_VERSION: i64 = 2;

/// 工作区库的完整结构：新建库时一次性执行，全部语句幂等。
const SCHEMA: &str = r#"CREATE TABLE IF NOT EXISTS ai_audit (
    id         TEXT PRIMARY KEY NOT NULL,
    tool       TEXT NOT NULL,
    node_id    TEXT,
    summary    TEXT NOT NULL DEFAULT '',
    risk       TEXT NOT NULL,
    outcome    TEXT NOT NULL CHECK (outcome IN ('direct', 'inbox', 'approved', 'rejected', 'failed', 'denied')),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_inbox (
    id           TEXT PRIMARY KEY NOT NULL,
    tool         TEXT NOT NULL,
    node_id      TEXT,
    payload_json TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    risk         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'failed')),
    error        TEXT,
    created_at   INTEGER NOT NULL,
    decided_at   INTEGER
);

CREATE TABLE IF NOT EXISTS attachment (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    logical_path TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    size         INTEGER NOT NULL CHECK (size >= 0),
    mime         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted_at   INTEGER,
    scope        TEXT NOT NULL DEFAULT 'library' CHECK (scope IN ('library', 'node')),
    expires_at   INTEGER,
    orphaned_at  INTEGER
);

CREATE TABLE IF NOT EXISTS attachment_blob (
    hash         TEXT PRIMARY KEY NOT NULL,
    size         INTEGER NOT NULL CHECK (size >= 0),
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('big', 'pack')),
    pack_id      TEXT,
    pack_offset  INTEGER,
    created_at   INTEGER NOT NULL,
    FOREIGN KEY (pack_id) REFERENCES attachment_pack(id) ON DELETE RESTRICT,
    CHECK (
        (storage_kind = 'big' AND pack_id IS NULL AND pack_offset IS NULL)
        OR
        (storage_kind = 'pack' AND pack_id IS NOT NULL AND pack_offset IS NOT NULL AND pack_offset >= 0)
    )
);

CREATE TABLE IF NOT EXISTS attachment_pack (
    id         TEXT PRIMARY KEY NOT NULL,
    file_name  TEXT NOT NULL UNIQUE,
    size       INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
    active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    retired_at INTEGER
);

CREATE TABLE IF NOT EXISTS attachment_preview (
    attachment_id     TEXT PRIMARY KEY NOT NULL,
    kind              TEXT NOT NULL,
    payload_json      TEXT NOT NULL,
    source_updated_at INTEGER NOT NULL,
    FOREIGN KEY (attachment_id) REFERENCES attachment(id) ON DELETE CASCADE
);

CREATE TABLE board_library (
    id          TEXT PRIMARY KEY NOT NULL,
    preset_key  TEXT UNIQUE,
    name        TEXT NOT NULL,
    author      TEXT NOT NULL DEFAULT '',
    license     TEXT NOT NULL DEFAULT '',
    source_url  TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL CHECK (source_type IN ('preset', 'import')),
    enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    item_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE board_library_item (
    id            TEXT PRIMARY KEY NOT NULL,
    library_id    TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    elements_json TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (library_id) REFERENCES board_library(id) ON DELETE CASCADE
);

CREATE TABLE board_scene (
    node_id        TEXT PRIMARY KEY NOT NULL,
    elements_json  TEXT NOT NULL DEFAULT '[]',
    app_state_json TEXT NOT NULL DEFAULT '{}',
    scene_version  INTEGER NOT NULL DEFAULT 1,
    element_count  INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE board_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    scroll_x   REAL NOT NULL DEFAULT 0,
    scroll_y   REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE doc_block_hash (
    hash TEXT PRIMARY KEY NOT NULL,
    json TEXT NOT NULL
);

CREATE TABLE doc_block_meta (
    id          TEXT PRIMARY KEY NOT NULL,
    markdown    TEXT NOT NULL DEFAULT '',
    prop        TEXT NOT NULL DEFAULT '{}',
    update_time INTEGER NOT NULL,
    FOREIGN KEY (id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE doc_block_tree (
    id      TEXT PRIMARY KEY NOT NULL,
    node_id TEXT NOT NULL,
    hash    TEXT NOT NULL,
    "order" TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE,
    FOREIGN KEY (hash) REFERENCES doc_block_hash(hash)
);

CREATE TABLE doc_history (
    id          TEXT PRIMARY KEY NOT NULL,
    node_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    word_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE knowledge_base (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE mindmap_scene (
    node_id         TEXT PRIMARY KEY NOT NULL,
    content_json    TEXT NOT NULL,
    content_version INTEGER NOT NULL DEFAULT 1,
    topic_count     INTEGER NOT NULL DEFAULT 1,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE mindmap_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE "node" (
    id                TEXT PRIMARY KEY NOT NULL,
    type              INTEGER NOT NULL CHECK (type IN (1, 2, 3, 6, 7)),
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
    doc_version       INTEGER NOT NULL DEFAULT 0,
    deleted_at        INTEGER,
    FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE node_attachment (
    node_id    TEXT NOT NULL,
    object_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (node_id, object_id),
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE,
    FOREIGN KEY (object_id) REFERENCES attachment(id) ON DELETE CASCADE
);

CREATE TABLE node_preview (
    node_id           TEXT PRIMARY KEY NOT NULL,
    object_id         TEXT NOT NULL,
    width             INTEGER NOT NULL CHECK (width > 0),
    height            INTEGER NOT NULL CHECK (height > 0),
    source_updated_at INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE node_search USING fts5(
    title,
    body,
    content='search_index',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TABLE search_index (
    node_id     TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    kb_id       TEXT NOT NULL,
    node_type   INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE workspace_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE INDEX idx_ai_audit_created
    ON ai_audit(created_at DESC);

CREATE INDEX idx_ai_inbox_status_created
    ON ai_inbox(status, created_at DESC);

CREATE INDEX idx_attachment_active_path
    ON attachment(logical_path, name) WHERE status = 'active';

CREATE INDEX idx_attachment_blob_pack
    ON attachment_blob(pack_id, pack_offset);

CREATE INDEX idx_attachment_hash
    ON attachment(content_hash);

CREATE INDEX idx_attachment_lifecycle
    ON attachment(scope, status, orphaned_at, expires_at);

CREATE INDEX idx_attachment_status
    ON attachment(status, updated_at DESC);

CREATE INDEX idx_board_library_item_library
    ON board_library_item(library_id, sort_order);

CREATE INDEX idx_doc_block_tree_hash
    ON doc_block_tree(hash);

CREATE INDEX idx_doc_block_tree_node_order
    ON doc_block_tree(node_id, "order");

CREATE INDEX idx_doc_history_node_created
    ON doc_history(node_id, created_at DESC);

CREATE INDEX idx_knowledge_base_sort
    ON knowledge_base(sort_order, created_at);

CREATE INDEX idx_mindmap_scene_updated
    ON mindmap_scene(updated_at DESC);

CREATE INDEX idx_node_attachment_object
    ON node_attachment(object_id);

CREATE INDEX idx_node_deleted
    ON node(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE INDEX idx_node_kb
    ON node(knowledge_base_id);

CREATE INDEX idx_node_kb_parent_sort
    ON node(knowledge_base_id, parent_id, sort_order);

CREATE INDEX idx_node_parent
    ON node(parent_id);

CREATE INDEX idx_node_preview_updated
    ON node_preview(updated_at DESC);

CREATE INDEX idx_search_index_kb_updated
    ON search_index(kb_id, updated_at DESC);

CREATE UNIQUE INDEX uq_attachment_pack_active
    ON attachment_pack(active) WHERE active = 1;

CREATE TRIGGER search_index_ad AFTER DELETE ON search_index BEGIN
    INSERT INTO node_search(node_search, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER search_index_ai AFTER INSERT ON search_index BEGIN
    INSERT INTO node_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER search_index_au AFTER UPDATE ON search_index BEGIN
    INSERT INTO node_search(node_search, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO node_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;"#;

/// 仅建立连接：不建表、不校验版本；供启动初始化任务使用。
///
/// @param path `db/workspace.sqlite3` 的绝对路径
/// @returns 已开启外键与 WAL 的连接
pub fn open_connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    configure(&connection)?;
    Ok(connection)
}

/// 打开（必要时按当前结构创建）工作区库。
pub fn open(path: &Path) -> AppResult<Connection> {
    let mut connection = open_connection(path)?;
    ensure_initialized(&mut connection)?;
    Ok(connection)
}

/// 打开已存在的工作区库（不初始化），供后台派生写入使用。
pub fn open_existing(path: &Path) -> AppResult<Connection> {
    if !path.is_file() {
        return Err(AppError::InvalidWorkspace);
    }
    open_connection(path)
}

/// 初始化工作区库：空库按当前结构一次性建好；版本不一致直接拒绝。
///
/// 不做迁移、不做结构自愈、不猜测旧结构：见到旧版本库就返回可读错误，
/// 由用户删除该工作区后重建（本项目不保留历史数据）。
pub fn ensure_initialized(connection: &mut Connection) -> AppResult<()> {
    let version = current_version(connection)?;
    if version == SCHEMA_VERSION {
        return Ok(());
    }
    if version != 0 {
        logging::error(
            "db.workspace",
            &format!("工作区库版本 {version} 与当前 {SCHEMA_VERSION} 不一致，拒绝打开"),
        );
        return Err(AppError::validation(
            "该工作区由旧版本创建，本项目不保留历史数据；请删除该工作区后重新创建",
        ));
    }
    let tables: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if tables > 0 {
        // 版本为 0 却有表：不是本程序建的库，拒绝而不是“补齐”。
        logging::error("db.workspace", "库版本为 0 但已存在表，拒绝初始化");
        return Err(AppError::validation(
            "该文件夹不是星屿工作区；请选择空文件夹重新创建",
        ));
    }
    let transaction = connection.transaction()?;
    transaction.execute_batch(SCHEMA)?;
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    logging::info(
        "db.workspace",
        &format!("工作区库已按当前结构创建 version={SCHEMA_VERSION}"),
    );
    Ok(())
}

/// 读取当前 schema 版本。
fn current_version(connection: &Connection) -> AppResult<i64> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::from)
}

/// 连接级 PRAGMA：外键级联删除、WAL、忙等待。
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

    fn table_names(connection: &Connection) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .expect("准备查询");
        statement
            .query_map([], |row| row.get(0))
            .expect("读取表名")
            .collect::<rusqlite::Result<Vec<String>>>()
            .expect("收集表名")
    }

    #[test]
    fn fresh_schema_is_complete_and_idempotent() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("workspace.sqlite3");
        let mut connection = open_connection(&path).expect("打开");
        ensure_initialized(&mut connection).expect("初始化");
        let version = current_version(&connection).expect("读版本");
        assert_eq!(version, SCHEMA_VERSION, "新建库写入当前 schema 版本");
        let names = table_names(&connection);
        for expected in [
            "node",
            "attachment",
            "attachment_preview",
            "doc_block_tree",
            "node_search",
        ] {
            assert!(
                names.iter().any(|name| name == expected),
                "缺少表 {expected}"
            );
        }
        // 再次初始化不应改动任何结构。
        ensure_initialized(&mut connection).expect("重复初始化");
        assert_eq!(table_names(&connection), names, "重复初始化结构不变");
    }

    #[test]
    fn node_type_check_rejects_retired_types() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("workspace.sqlite3");
        let mut connection = open_connection(&path).expect("打开");
        ensure_initialized(&mut connection).expect("初始化");
        connection
            .execute(
                "INSERT INTO knowledge_base (id, name, created_at, updated_at) VALUES ('kb-1', '库', 1, 1)",
                [],
            )
            .expect("插入知识库");
        let insert = |id: &str, node_type: i64| {
            connection.execute(
                "INSERT INTO node (id, type, title, knowledge_base_id, level, path, create_time, update_time)
                 VALUES (?1, ?2, '节点', 'kb-1', 1, '/节点', 1, 1)",
                rusqlite::params![id, node_type],
            )
        };
        assert!(insert("node-ok", 7).is_ok(), "思维导图是当前类型");
        for retired in [4, 5, 0, 8] {
            assert!(
                insert(&format!("node-{retired}"), retired).is_err(),
                "类型 {retired} 不得入库"
            );
        }
    }

    #[test]
    fn outdated_workspace_is_rejected_without_changes() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("workspace.sqlite3");
        let mut connection = open_connection(&path).expect("打开");
        ensure_initialized(&mut connection).expect("初始化");
        connection
            .pragma_update(None, "user_version", 999)
            .expect("改版本");
        let error = ensure_initialized(&mut connection).expect_err("旧版本必须拒绝");
        assert!(
            format!("{error}").contains("不保留历史数据"),
            "错误信息要说明不保留历史数据：{error}"
        );
        let version = current_version(&connection).expect("读版本");
        assert_eq!(version, 999, "拒绝时不改动版本");
    }

    #[test]
    fn foreign_tables_with_version_zero_are_rejected() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("workspace.sqlite3");
        let mut connection = open_connection(&path).expect("打开");
        connection
            .execute_batch("CREATE TABLE legacy_thing (id TEXT);")
            .expect("造外部库");
        let error = ensure_initialized(&mut connection).expect_err("外部库必须拒绝");
        assert!(
            format!("{error}").contains("不是星屿工作区"),
            "错误信息要说明不是工作区：{error}"
        );
    }
}
