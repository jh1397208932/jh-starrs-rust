//! 单个本地工作区的 SQLite 数据库：知识库与文件树节点。
//!
//! 每个工作区一个连接、一个文件；切换工作区即替换连接（统一入口见 workspace_service）。

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::domain::attachment_refs;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::utils::now_ms;

/// 工作区库结构版本。
const SCHEMA_VERSION: i64 = 10;
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
/// v4 → v5：附件逻辑元数据、物理对象与 pack 索引。
///
/// `attachment.content_hash` 故意不建外键：逻辑行软删除后仍需保留哈希用于审计，
/// 而物理 blob 行可能在引用归零时被删除。哈希查询由索引保证。
const MIGRATION_V4_TO_V5: &str = r#"
CREATE TABLE IF NOT EXISTS attachment_pack (
    id         TEXT PRIMARY KEY NOT NULL,
    file_name  TEXT NOT NULL UNIQUE,
    size       INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
    active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at INTEGER NOT NULL,
    retired_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attachment_pack_active
    ON attachment_pack(active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS attachment_blob (
    hash         TEXT PRIMARY KEY NOT NULL,
    size         INTEGER NOT NULL CHECK (size >= 0),
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('big', 'pack')),
    pack_id      TEXT,
    pack_offset  INTEGER,
    ref_count    INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
    created_at   INTEGER NOT NULL,
    FOREIGN KEY (pack_id) REFERENCES attachment_pack(id) ON DELETE RESTRICT,
    CHECK (
        (storage_kind = 'big' AND pack_id IS NULL AND pack_offset IS NULL)
        OR
        (storage_kind = 'pack' AND pack_id IS NOT NULL AND pack_offset IS NOT NULL AND pack_offset >= 0)
    )
);
CREATE INDEX IF NOT EXISTS idx_attachment_blob_pack
    ON attachment_blob(pack_id, pack_offset);

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
    deleted_at   INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attachment_active_path
    ON attachment(logical_path, name) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_attachment_hash
    ON attachment(content_hash);
CREATE INDEX IF NOT EXISTS idx_attachment_status
    ON attachment(status, updated_at DESC);
"#;
/// v5 → v6：撤下「同目录同名唯一」约束。
///
/// 文件名只是展示元数据，附件身份是 `id`、内容去重靠 BLAKE3；两张都叫
/// `image.png` 的截图必须都能上传，各自拿到 id 并共享同一物理对象。
/// 目录检索仍走非唯一索引。
const MIGRATION_V5_TO_V6: &str = r#"
DROP INDEX IF EXISTS uq_attachment_active_path;
CREATE INDEX IF NOT EXISTS idx_attachment_active_path
    ON attachment(logical_path, name) WHERE status = 'active';
"#;
/// v6 → v7：去掉 `attachment_blob.ref_count`。
///
/// 该计数是冗余的：物理对象该不该存在，唯一判据是"还有没有活跃 `attachment` 行引用
/// 这个哈希"，一条按哈希索引的 COUNT 就能算出来。列上带 CHECK 约束，SQLite 不允许
/// 直接 DROP COLUMN，因此按官方做法重建表并搬运数据。
const MIGRATION_V6_TO_V7: &str = r#"
CREATE TABLE attachment_blob_v7 (
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
INSERT INTO attachment_blob_v7 (hash, size, storage_kind, pack_id, pack_offset, created_at)
SELECT hash, size, storage_kind, pack_id, pack_offset, created_at FROM attachment_blob;
DROP TABLE attachment_blob;
ALTER TABLE attachment_blob_v7 RENAME TO attachment_blob;
CREATE INDEX IF NOT EXISTS idx_attachment_blob_pack
    ON attachment_blob(pack_id, pack_offset);
"#;
/// v7 → v8：画板场景与视口。
///
/// 画板图片/附件不建映射表：图片元素 `fileId` 直接使用全局对象 id，
/// 文件卡片把 objectId 写在图元 customData 里。画板只拥有场景与视口。
const MIGRATION_V7_TO_V8: &str = r#"
CREATE TABLE IF NOT EXISTS board_scene (
    node_id        TEXT PRIMARY KEY NOT NULL,
    elements_json  TEXT NOT NULL DEFAULT '[]',
    app_state_json TEXT NOT NULL DEFAULT '{}',
    scene_version  INTEGER NOT NULL DEFAULT 1,
    element_count  INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    scroll_x   REAL NOT NULL DEFAULT 0,
    scroll_y   REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);
"#;

/// v8 → v9：组件库与库内组件；预设用 preset_key 去重，导入库可删除。
const MIGRATION_V8_TO_V9: &str = r#"
CREATE TABLE IF NOT EXISTS board_library (
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

CREATE TABLE IF NOT EXISTS board_library_item (
    id            TEXT PRIMARY KEY NOT NULL,
    library_id    TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    elements_json TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (library_id) REFERENCES board_library(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_library_item_library
    ON board_library_item(library_id, sort_order);
"#;

/// v9 → v10：附件引用表、生命周期字段与附件节点类型。
///
/// node.type 的 CHECK 不能原地修改，必须重建表；重建期间关闭外键并用
/// `legacy_alter_table` 防止 SQLite 改写依赖表的 FK 名称。迁移末尾会执行
/// `PRAGMA foreign_key_check`，任何悬空引用都会拒绝启动，而不是带着坏库运行。
const MIGRATION_V9_TO_V10: &str = r#"
CREATE TABLE node_v10 (
    id                TEXT PRIMARY KEY NOT NULL,
    type              INTEGER NOT NULL CHECK (type BETWEEN 1 AND 6),
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
INSERT INTO node_v10
    (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
     starred, word_count, content, create_time, update_time)
SELECT
    id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
    starred, word_count, content, create_time, update_time
FROM node;
DROP TABLE node;
ALTER TABLE node_v10 RENAME TO node;
CREATE INDEX IF NOT EXISTS idx_node_kb_parent_sort
    ON node(knowledge_base_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_node_parent
    ON node(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_kb
    ON node(knowledge_base_id);

ALTER TABLE attachment
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'library' CHECK (scope IN ('library', 'node'));
ALTER TABLE attachment ADD COLUMN expires_at INTEGER;
ALTER TABLE attachment ADD COLUMN orphaned_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_attachment_lifecycle
    ON attachment(scope, status, orphaned_at, expires_at);

CREATE TABLE IF NOT EXISTS node_attachment (
    node_id    TEXT NOT NULL,
    object_id  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (node_id, object_id),
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE,
    FOREIGN KEY (object_id) REFERENCES attachment(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_node_attachment_object
    ON node_attachment(object_id);

CREATE TABLE IF NOT EXISTS workspace_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS board_scene (
    node_id        TEXT PRIMARY KEY NOT NULL,
    elements_json  TEXT NOT NULL DEFAULT '[]',
    app_state_json TEXT NOT NULL DEFAULT '{}',
    scene_version  INTEGER NOT NULL DEFAULT 1,
    element_count  INTEGER NOT NULL DEFAULT 0,
    updated_at     INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    scroll_x   REAL NOT NULL DEFAULT 0,
    scroll_y   REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_library (
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

CREATE TABLE IF NOT EXISTS board_library_item (
    id            TEXT PRIMARY KEY NOT NULL,
    library_id    TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    elements_json TEXT NOT NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    FOREIGN KEY (library_id) REFERENCES board_library(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_board_library_item_library
    ON board_library_item(library_id, sort_order);
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

/// 按 `PRAGMA user_version` 迁移；保护现有数据，失败整体回滚。
fn migrate(connection: &mut Connection) -> AppResult<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version > SCHEMA_VERSION {
        logging::error(
            "db.workspace",
            &format!("工作区库版本 {version} 高于程序支持的 {SCHEMA_VERSION}"),
        );
        return Err(AppError::Internal);
    }
    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    // v10 重建 node 表：必须在事务外关闭外键，并禁止 SQLite 改写依赖表的 FK 名称。
    let rebuild_node = version < 10;
    if rebuild_node {
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        connection.pragma_update(None, "legacy_alter_table", "ON")?;
    }

    let result = (|| -> AppResult<()> {
        let transaction = connection.transaction()?;
        if version == 0 {
            transaction.execute_batch(SCHEMA)?;
            transaction.execute_batch(MIGRATION_V4_TO_V5)?;
            transaction.execute_batch(MIGRATION_V5_TO_V6)?;
            transaction.execute_batch(MIGRATION_V6_TO_V7)?;
            transaction.execute_batch(MIGRATION_V7_TO_V8)?;
            transaction.execute_batch(MIGRATION_V8_TO_V9)?;
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
            if version <= 4 {
                transaction.execute_batch(MIGRATION_V4_TO_V5)?;
            }
            if version <= 5 {
                transaction.execute_batch(MIGRATION_V5_TO_V6)?;
            }
            if version <= 6 {
                transaction.execute_batch(MIGRATION_V6_TO_V7)?;
            }
            if version <= 7 {
                transaction.execute_batch(MIGRATION_V7_TO_V8)?;
            }
            if version <= 8 {
                transaction.execute_batch(MIGRATION_V8_TO_V9)?;
            }
        }
        if version <= 9 {
            transaction.execute_batch(MIGRATION_V9_TO_V10)?;
            backfill_attachment_relations(&transaction)?;
        }
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        transaction.commit()?;
        Ok(())
    })();

    if rebuild_node {
        connection.pragma_update(None, "legacy_alter_table", "OFF")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
    }
    result?;

    if rebuild_node {
        let violations = foreign_key_violation_count(connection)?;
        if violations > 0 {
            logging::error(
                "db.workspace",
                &format!("工作区库迁移后存在 {violations} 条外键悬空引用"),
            );
            return Err(AppError::Internal);
        }
    }
    logging::info(
        "db.workspace",
        &format!("工作区库迁移完成，版本={SCHEMA_VERSION}"),
    );
    Ok(())
}

/// 迁移回填：从既有文档正文与画板场景建立附件引用。
///
/// 单条 JSON 损坏只记日志并跳过该节点，不让一条坏数据阻塞整个工作区打开；
/// 其余节点仍会建立引用，后续维护任务也能发现未关联对象。
fn backfill_attachment_relations(transaction: &rusqlite::Transaction<'_>) -> AppResult<()> {
    let now = now_ms();
    let mut inserted = 0_usize;

    let documents = {
        let mut statement =
            transaction.prepare("SELECT id, content FROM node WHERE type = 2 AND content <> ''")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (node_id, content) in documents {
        match serde_json::from_str::<Value>(&content) {
            Ok(document) => {
                let object_ids = attachment_refs::collect_document_attachment_ids(&document);
                inserted += insert_attachment_refs(transaction, &node_id, &object_ids, now)?;
            }
            Err(error) => logging::error(
                "db.workspace",
                &format!("回填附件引用时文档解析失败 node={node_id}: {error}"),
            ),
        }
    }

    let boards = {
        let mut statement = transaction.prepare(
            "SELECT s.node_id, s.elements_json
             FROM board_scene s JOIN node n ON n.id = s.node_id
             WHERE n.type = 3",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    for (node_id, elements_json) in boards {
        match serde_json::from_str::<Value>(&elements_json) {
            Ok(elements) => {
                let object_ids = attachment_refs::collect_board_attachment_ids(&elements);
                inserted += insert_attachment_refs(transaction, &node_id, &object_ids, now)?;
            }
            Err(error) => logging::error(
                "db.workspace",
                &format!("回填附件引用时画板解析失败 node={node_id}: {error}"),
            ),
        }
    }

    transaction.execute(
        "UPDATE attachment SET scope = 'node'
         WHERE scope = 'library'
           AND EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = attachment.id)",
        [],
    )?;
    logging::info("db.workspace", &format!("附件引用回填完成 refs={inserted}"));
    Ok(())
}

/// 插入引用；object_id 必须仍存在于 attachment 表，避免坏 JSON 触发外键失败。
fn insert_attachment_refs(
    transaction: &rusqlite::Transaction<'_>,
    node_id: &str,
    object_ids: &BTreeSet<String>,
    now: i64,
) -> AppResult<usize> {
    let mut inserted = 0;
    for object_id in object_ids {
        inserted += transaction.execute(
            "INSERT OR IGNORE INTO node_attachment (node_id, object_id, created_at, updated_at)
             SELECT ?1, ?2, ?3, ?3
             WHERE EXISTS (SELECT 1 FROM attachment WHERE id = ?2)",
            rusqlite::params![node_id, object_id, now],
        )?;
    }
    Ok(inserted)
}

/// 统计外键悬空引用数；0 表示迁移后的关系完整。
fn foreign_key_violation_count(connection: &Connection) -> AppResult<i64> {
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    let count = statement.query_map([], |_| Ok(()))?.count();
    Ok(count as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// v1 旧库的最小可迁移结构：保留真实节点字段，只把时间列名留在旧版本。
    const V1_NODE_SCHEMA: &str = r#"
        CREATE TABLE knowledge_base (
            id          TEXT PRIMARY KEY NOT NULL,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE TABLE node (
            id                TEXT PRIMARY KEY NOT NULL,
            type              INTEGER NOT NULL,
            title             TEXT NOT NULL,
            knowledge_base_id TEXT NOT NULL,
            parent_id         TEXT,
            level             INTEGER NOT NULL,
            path              TEXT NOT NULL,
            sort_order        INTEGER NOT NULL DEFAULT 0,
            starred           INTEGER NOT NULL DEFAULT 0,
            word_count        INTEGER NOT NULL DEFAULT 0,
            content           TEXT NOT NULL DEFAULT '',
            created_at        INTEGER NOT NULL,
            updated_at        INTEGER NOT NULL
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
                .execute_batch(
                    "INSERT INTO knowledge_base
                         (id, name, description, sort_order, created_at, updated_at)
                     VALUES ('kb1', '旧库', '', 0, 1, 1);
                     INSERT INTO node
                         (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
                          starred, word_count, content, created_at, updated_at)
                     VALUES ('n1', 2, '旧数据', 'kb1', NULL, 1, '/旧数据', 0, 0, 0, '', 1, 2);",
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
        assert_eq!(version, 10, "迁移必须停在 v10");

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

        let attachment_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(attachment)")
            .expect("附件表")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历附件列")
            .collect::<Result<_, _>>()
            .expect("附件列名");
        assert_eq!(
            attachment_columns,
            vec![
                "id",
                "name",
                "logical_path",
                "content_hash",
                "size",
                "mime",
                "status",
                "created_at",
                "updated_at",
                "deleted_at",
                "scope",
                "expires_at",
                "orphaned_at"
            ],
            "v10 必须为 attachment 增加生命周期列"
        );
        let blob_columns: Vec<String> = connection
            .prepare("PRAGMA table_info(attachment_blob)")
            .expect("附件对象表")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历附件对象列")
            .collect::<Result<_, _>>()
            .expect("附件对象列名");
        assert_eq!(
            blob_columns,
            vec![
                "hash",
                "size",
                "storage_kind",
                "pack_id",
                "pack_offset",
                "created_at"
            ],
            "v7 必须重建 attachment_blob 且不含 ref_count"
        );
        assert!(
            !blob_columns.contains(&"ref_count".to_string()),
            "v7 必须去掉冗余的引用计数列，实际列：{blob_columns:?}"
        );
        connection
            .prepare("SELECT id, file_name, size, active FROM attachment_pack LIMIT 0")
            .expect("v5 必须创建 attachment_pack");

        let attachment_indexes: Vec<String> = connection
            .prepare(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'attachment'
                 ORDER BY name",
            )
            .expect("附件索引")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("遍历附件索引")
            .collect::<Result<_, _>>()
            .expect("附件索引名");
        assert!(
            !attachment_indexes.contains(&"uq_attachment_active_path".to_string()),
            "v6 必须撤下同名唯一索引，实际索引：{attachment_indexes:?}"
        );
        assert!(
            attachment_indexes.contains(&"idx_attachment_active_path".to_string()),
            "v6 必须保留目录检索用的非唯一索引，实际索引：{attachment_indexes:?}"
        );

        // 唯一索引真的没了：同目录同名的两条活跃行可以同时写入。
        connection
            .execute_batch(
                "INSERT INTO attachment
                     (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at)
                 VALUES
                     ('a1', 'image.png', 'docs', 'h1', 1, 'image/png', 'active', 1, 1),
                     ('a2', 'image.png', 'docs', 'h2', 1, 'image/png', 'active', 1, 1);",
            )
            .expect("v6 允许同目录同名附件并存");

        let title: String = connection
            .query_row("SELECT title FROM node WHERE id = 'n1'", [], |row| {
                row.get(0)
            })
            .expect("旧数据保留");
        assert_eq!(title, "旧数据");
    }

    #[test]
    fn migrates_v9_to_v10_and_backfills_attachment_refs() {
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        {
            let connection = Connection::open(&path).expect("创建 v9 库");
            connection.execute_batch(SCHEMA).expect("基础表");
            for migration in [
                MIGRATION_V4_TO_V5,
                MIGRATION_V5_TO_V6,
                MIGRATION_V6_TO_V7,
                MIGRATION_V7_TO_V8,
                MIGRATION_V8_TO_V9,
            ] {
                connection.execute_batch(migration).expect("v9 迁移");
            }
            connection
                .pragma_update(None, "user_version", 9)
                .expect("写 v9 版本");
            connection
                .execute_batch(
                    r#"INSERT INTO knowledge_base (id, name, description, sort_order, created_at, updated_at)
                     VALUES ('kb1', 'KB', '', 0, 1, 1);
                     INSERT INTO node
                         (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
                          starred, word_count, content, create_time, update_time)
                     VALUES
                         ('doc1', 2, 'Doc', 'kb1', NULL, 1, '/Doc', 0, 0, 0,
                          '{"type":"doc","content":[{"type":"attachmentImage","attrs":{"attachmentId":"a1"}}]}', 1, 1),
                         ('board1', 3, 'Board', 'kb1', NULL, 1, '/Board', 1, 0, 0, '', 1, 1);
                     INSERT INTO board_scene
                         (node_id, elements_json, app_state_json, scene_version, element_count, updated_at)
                     VALUES ('board1', '[{"type":"image","fileId":"a2"}]', '{}', 1, 1, 1);
                     INSERT INTO attachment
                         (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at)
                     VALUES
                         ('a1', 'doc.png', '', 'h1', 1, 'image/png', 'active', 1, 1),
                         ('a2', 'board.png', '', 'h2', 1, 'image/png', 'active', 1, 1),
                         ('a3', 'library.txt', '', 'h3', 1, 'text/plain', 'active', 1, 1);"#,
                )
                .expect("写入 v9 数据");
        }

        let connection = open(&path).expect("迁移打开");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, 10);

        let refs: Vec<(String, String)> = connection
            .prepare("SELECT node_id, object_id FROM node_attachment ORDER BY node_id, object_id")
            .expect("引用表")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("遍历引用")
            .collect::<Result<_, _>>()
            .expect("引用行");
        assert_eq!(
            refs,
            vec![
                ("board1".to_string(), "a2".to_string()),
                ("doc1".to_string(), "a1".to_string())
            ]
        );

        let scopes: Vec<(String, String)> = connection
            .prepare("SELECT id, scope FROM attachment ORDER BY id")
            .expect("附件 scope")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("遍历 scope")
            .collect::<Result<_, _>>()
            .expect("scope 行");
        assert_eq!(
            scopes,
            vec![
                ("a1".to_string(), "node".to_string()),
                ("a2".to_string(), "node".to_string()),
                ("a3".to_string(), "library".to_string())
            ]
        );

        // type=6 已可写入。
        connection
            .execute(
                "INSERT INTO node
                     (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
                      starred, word_count, content, create_time, update_time)
                 VALUES ('att1', 6, 'file.png', 'kb1', NULL, 1, '/file.png', 2, 0, 0, '', 1, 1)",
                [],
            )
            .expect("v10 必须允许附件节点");

        let violations: i64 = connection
            .prepare("PRAGMA foreign_key_check")
            .expect("外键检查")
            .query_map([], |_| Ok(()))
            .expect("遍历外键问题")
            .count() as i64;
        assert_eq!(violations, 0);
    }

    #[test]
    fn migrates_v6_blob_rows_to_v7_without_losing_objects() {
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        let hash = "ab".repeat(32);
        {
            let connection = Connection::open(&path).expect("创建 v6 库");
            connection.execute_batch(SCHEMA).expect("基础表");
            connection.execute_batch(MIGRATION_V4_TO_V5).expect("v5 表");
            connection
                .execute_batch(MIGRATION_V5_TO_V6)
                .expect("v6 索引");
            connection
                .pragma_update(None, "user_version", 6)
                .expect("写 v6 版本");
            connection
                .execute(
                    "INSERT INTO attachment_pack (id, file_name, size, active, created_at)
                     VALUES ('p1', 'p1.pack', 10, 1, 1)",
                    [],
                )
                .expect("插入 pack");
            connection
                .execute(
                    "INSERT INTO attachment_blob
                         (hash, size, storage_kind, pack_id, pack_offset, ref_count, created_at)
                     VALUES (?1, 10, 'pack', 'p1', 0, 3, 1)",
                    [&hash],
                )
                .expect("插入 v6 blob 行");
            connection
                .execute(
                    "INSERT INTO attachment
                         (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at)
                     VALUES ('a1', 'x.txt', '', ?1, 10, 'text/plain', 'active', 1, 1)",
                    [&hash],
                )
                .expect("插入附件行");
        }

        let connection = open(&path).expect("迁移打开");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, 10, "v8 库必须升到 v10");

        let columns: Vec<String> = connection
            .prepare("PRAGMA table_info(attachment_blob)")
            .expect("附件对象表")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("遍历列")
            .collect::<Result<_, _>>()
            .expect("列名");
        assert!(
            !columns.contains(&"ref_count".to_string()),
            "重建后不得保留 ref_count，实际列：{columns:?}"
        );

        let (size, kind, pack_id, offset): (i64, String, String, i64) = connection
            .query_row(
                "SELECT size, storage_kind, pack_id, pack_offset FROM attachment_blob WHERE hash = ?1",
                [&hash],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("重建必须保留 blob 行");
        assert_eq!(
            (size, kind.as_str(), pack_id.as_str(), offset),
            (10, "pack", "p1", 0)
        );

        // 历史上的 ref_count=3 不再参与判定：引用数按活跃附件现算。
        let references: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM attachment WHERE content_hash = ?1 AND status = 'active'",
                [&hash],
                |row| row.get(0),
            )
            .expect("引用数");
        assert_eq!(references, 1, "引用数由活跃附件行决定，不再读计数器");

        let index_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_attachment_blob_pack'",
                [],
                |row| row.get(0),
            )
            .expect("索引");
        assert_eq!(index_count, 1, "重建后必须补回 pack 索引");
    }
}
