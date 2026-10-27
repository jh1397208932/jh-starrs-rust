//! 单个本地工作区的 SQLite 数据库：知识库与文件树节点。
//!
//! 每个工作区一个连接、一个文件；切换工作区即替换连接（统一入口见 workspace_service）。

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::domain::attachment_refs;
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::utils::now_ms;

/// 工作区库结构版本。
const SCHEMA_VERSION: i64 = 15;
/// 迁移前备份目录（相对工作区 `db/`）。
const BACKUP_DIR: &str = "backups";
/// 保留的迁移备份份数。
const BACKUP_KEEP: usize = 3;
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
CREATE INDEX IF NOT EXISTS idx_ai_inbox_status_created
    ON ai_inbox(status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_audit (
    id         TEXT PRIMARY KEY NOT NULL,
    tool       TEXT NOT NULL,
    node_id    TEXT,
    summary    TEXT NOT NULL DEFAULT '',
    risk       TEXT NOT NULL,
    outcome    TEXT NOT NULL CHECK (outcome IN ('direct', 'inbox', 'approved', 'rejected', 'failed', 'denied')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_audit_created
    ON ai_audit(created_at DESC);
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

/// v10 → v11：文档正文版本号，用于保存时的乐观并发控制。
///
/// 只增加列，不重建表；旧文档默认 0，首次保存即可写为 1。
const MIGRATION_V10_TO_V11: &str = r#"
ALTER TABLE node ADD COLUMN doc_version INTEGER NOT NULL DEFAULT 0;
"#;

/// v11 → v12：工作区检索索引。
///
/// `search_index` 是普通表（便于按 node_id 唯一维护），`node_search` 是
/// external-content FTS5 表；触发器保证两者同步。trigram tokenizer 支持
/// 中文子串检索（3 字以上），1–2 字由服务层走 LIKE 回退。
const MIGRATION_V11_TO_V12: &str = r#"
CREATE TABLE IF NOT EXISTS search_index (
    node_id     TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    kb_id       TEXT NOT NULL,
    node_type   INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_index_kb_updated
    ON search_index(kb_id, updated_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS node_search USING fts5(
    title,
    body,
    content='search_index',
    content_rowid='rowid',
    tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS search_index_ai AFTER INSERT ON search_index BEGIN
    INSERT INTO node_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS search_index_ad AFTER DELETE ON search_index BEGIN
    INSERT INTO node_search(node_search, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER IF NOT EXISTS search_index_au AFTER UPDATE ON search_index BEGIN
    INSERT INTO node_search(node_search, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO node_search(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

INSERT INTO search_index(node_id, title, body, kb_id, node_type, updated_at)
SELECT n.id, n.title, COALESCE(m.markdown, ''), n.knowledge_base_id, n.type, n.update_time
FROM node n LEFT JOIN doc_block_meta m ON m.id = n.id
ON CONFLICT(node_id) DO UPDATE SET
    title = excluded.title,
    body = excluded.body,
    kb_id = excluded.kb_id,
    node_type = excluded.node_type,
    updated_at = excluded.updated_at;

INSERT INTO node_search(node_search) VALUES('rebuild');
"#;

/// v12 → v13：文档历史快照。
const MIGRATION_V12_TO_V13: &str = r#"
CREATE TABLE IF NOT EXISTS doc_history (
    id          TEXT PRIMARY KEY NOT NULL,
    node_id     TEXT NOT NULL,
    content     TEXT NOT NULL,
    word_count  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_history_node_created
    ON doc_history(node_id, created_at DESC);
"#;

/// v13 → v14：节点回收站。软删除只打时间戳，附件引用与正文继续保留。
const MIGRATION_V13_TO_V14: &str = r#"
ALTER TABLE node ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_node_deleted
    ON node(deleted_at) WHERE deleted_at IS NOT NULL;
"#;

/// v14 → v15：思维导图节点类型与场景表。
///
/// `node.type` 的 CHECK 无法原地扩展，因此重建 node 表并保留 v11/v14 新增列。
/// 重建依赖 migrate() 在事务外关闭外键并启用 `legacy_alter_table`。
const MIGRATION_V14_TO_V15: &str = r#"
CREATE TABLE node_v15 (
    id                TEXT PRIMARY KEY NOT NULL,
    type              INTEGER NOT NULL CHECK (type BETWEEN 1 AND 7),
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
INSERT INTO node_v15
    (id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
     starred, word_count, content, create_time, update_time, doc_version, deleted_at)
SELECT
    id, type, title, knowledge_base_id, parent_id, level, path, sort_order,
    starred, word_count, content, create_time, update_time, doc_version, deleted_at
FROM node;
DROP TABLE node;
ALTER TABLE node_v15 RENAME TO node;
CREATE INDEX IF NOT EXISTS idx_node_kb_parent_sort
    ON node(knowledge_base_id, parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_node_parent
    ON node(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_kb
    ON node(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_node_deleted
    ON node(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS mindmap_scene (
    node_id         TEXT PRIMARY KEY NOT NULL,
    content_json    TEXT NOT NULL,
    content_version INTEGER NOT NULL DEFAULT 1,
    topic_count     INTEGER NOT NULL DEFAULT 1,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_mindmap_scene_updated
    ON mindmap_scene(updated_at DESC);

CREATE TABLE IF NOT EXISTS mindmap_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
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
    type              INTEGER NOT NULL CHECK (type BETWEEN 1 AND 7),
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

/// 仅建立工作区连接（轻量）：不备份、不迁移、不建表。
///
/// 供启动初始化与已就绪工作区的重新挂载使用；业务代码不得凭空假设结构完整，
/// 需要结构保证时调用 [`ensure_initialized`]。
pub fn open_connection(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let connection = Connection::open(path)?;
    configure(&connection)?;
    Ok(connection)
}

/// 打开（必要时创建）并完成全部登记的初始化任务。
///
/// 只允许启动装配、新建工作区与测试调用。
pub fn open(path: &Path) -> AppResult<Connection> {
    let mut connection = open_connection(path)?;
    initialize_workspace(&mut connection, path)?;
    Ok(connection)
}

/// 执行登记表里的工作区初始化任务（备份 → 版本迁移 → 结构自愈）。
///
/// @returns 实际执行的任务 id，按优先级排序，便于日志与测试核对
pub fn initialize_workspace(
    connection: &mut Connection,
    path: &Path,
) -> AppResult<Vec<&'static str>> {
    let existed = path.is_file();
    let version = current_version(connection)?;
    // 只有“已存在的旧库”才需要备份；新建库或已是最新版本直接跳过。
    if existed && version > 0 && version < SCHEMA_VERSION {
        backup_before_migrate(connection, path, version)?;
    }
    super::init_registry::run_tasks(connection, super::init_registry::WORKSPACE_TASKS)
}

/// 业务路径的结构保证：仅在检测到版本落后或核心表缺失时才执行登记任务。
///
/// 完整库上只做几次目录查询，不产生 DDL；漂移库则补齐并记录日志。
pub fn ensure_initialized(connection: &mut Connection, path: &Path) -> AppResult<()> {
    if !needs_initialization(connection)? {
        return Ok(());
    }
    logging::info("db.workspace", "工作区需要初始化，执行登记任务");
    let executed = initialize_workspace(connection, path)?;
    logging::info(
        "db.workspace",
        &format!("工作区初始化完成 tasks={}", executed.join(",")),
    );
    Ok(())
}

/// 版本落后或结构残缺时返回 true（轻量目录查询，与自愈共用同一份清单）。
pub fn needs_initialization(connection: &Connection) -> AppResult<bool> {
    if current_version(connection)? < SCHEMA_VERSION {
        return Ok(true);
    }
    structure_needs_repair(connection)
}

/// 读取当前 schema 版本。
fn current_version(connection: &Connection) -> AppResult<i64> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(AppError::from)
}

/// 迁移前把数据库复制到 `db/backups/`，保留最近三份。
///
/// 复制前执行 WAL checkpoint，保证主库文件包含最新事务；复制失败会中止迁移，
/// 避免在“没有恢复点”的情况下修改用户数据。
fn backup_before_migrate(connection: &Connection, path: &Path, version: i64) -> AppResult<()> {
    let parent = path.parent().ok_or(AppError::FileSystem)?;
    let backup_dir = parent.join(BACKUP_DIR);
    fs::create_dir_all(&backup_dir)?;
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;

    let file_name = format!("workspace-v{version}-{}.sqlite3", crate::utils::now_ms());
    let backup_path = unique_backup_path(&backup_dir, &file_name);
    fs::copy(path, &backup_path)?;
    prune_backups(&backup_dir, BACKUP_KEEP)?;
    logging::info(
        "db.workspace",
        &format!(
            "迁移前备份完成 version={version} file={} bytes={}",
            backup_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown"),
            fs::metadata(&backup_path)
                .map(|meta| meta.len())
                .unwrap_or(0)
        ),
    );
    Ok(())
}

/// 同名备份已存在时追加序号，避免同一毫秒内覆盖。
fn unique_backup_path(directory: &Path, file_name: &str) -> PathBuf {
    let candidate = directory.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = file_name.trim_end_matches(".sqlite3");
    for index in 1..1000 {
        let next = directory.join(format!("{stem}-{index}.sqlite3"));
        if !next.exists() {
            return next;
        }
    }
    directory.join(format!("{stem}-overflow.sqlite3"))
}

/// 只保留最近 `keep` 份迁移备份；删除失败只记日志，不阻塞迁移。
fn prune_backups(directory: &Path, keep: usize) -> AppResult<()> {
    let mut backups: Vec<(SystemTime, PathBuf)> = fs::read_dir(directory)?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_str()?;
            if !name.starts_with("workspace-v") || !name.ends_with(".sqlite3") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    backups.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    while backups.len() > keep {
        let (_, oldest) = backups.remove(0);
        if let Err(error) = fs::remove_file(&oldest) {
            logging::error(
                "db.workspace",
                &format!(
                    "清理旧迁移备份失败 file={} error={error}",
                    oldest
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("unknown")
                ),
            );
        }
    }
    Ok(())
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

/// 初始化任务：按 `PRAGMA user_version` 迁移；保护现有数据，失败整体回滚。
pub(crate) fn task_schema_version(connection: &mut Connection) -> AppResult<()> {
    migrate(connection)
}

/// 初始化任务：版本号可信但结构残缺时按实际表/列补齐（历史中间构建的库）。
pub(crate) fn task_structure_repair(connection: &mut Connection) -> AppResult<()> {
    if !structure_needs_repair(connection)? {
        return Ok(());
    }
    let transaction = connection.transaction()?;
    repair_schema_gaps(&transaction)?;
    transaction.commit()?;
    logging::info(
        "db.workspace",
        "工作区库自愈完成：已补齐缺失的表/列并回填附件引用",
    );
    Ok(())
}

/// 初始化门与结构自愈共用的结构清单（单一事实源）。
///
/// 每项 = 表名 + 缺失时执行的幂等补齐语句；`None` 表示基线表，由 [`SCHEMA`] 一次性兜底。
/// 两条门（`needs_initialization` / `structure_needs_repair`）与 `repair_schema_gaps`
/// 都只读这张表，避免“门说需要初始化、自愈却永远补不上”的分叉。
const REQUIRED_STRUCTURES: &[(&str, Option<&str>)] = &[
    ("knowledge_base", None),
    ("node", None),
    ("doc_block_hash", None),
    ("doc_block_tree", None),
    ("doc_block_meta", None),
    ("board_scene", None),
    ("board_viewport", None),
    ("board_library", None),
    ("board_library_item", None),
    ("attachment_pack", Some(MIGRATION_V4_TO_V5)),
    ("attachment_blob", Some(MIGRATION_V4_TO_V5)),
    ("attachment", Some(MIGRATION_V4_TO_V5)),
    ("node_attachment", Some(REPAIR_NODE_ATTACHMENT)),
    ("workspace_meta", Some(REPAIR_WORKSPACE_META)),
    ("mindmap_scene", Some(REPAIR_MINDMAP_TABLES)),
    ("mindmap_viewport", Some(REPAIR_MINDMAP_TABLES)),
    ("search_index", Some(MIGRATION_V11_TO_V12)),
    ("doc_history", Some(MIGRATION_V12_TO_V13)),
    ("ai_inbox", Some(REPAIR_AI_TABLES)),
    ("ai_audit", Some(REPAIR_AI_TABLES)),
];

/// 轻量判断：任一必需表/列缺失即视为需要自愈。
fn structure_needs_repair(connection: &Connection) -> AppResult<bool> {
    for (table, _) in REQUIRED_STRUCTURES {
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            [table],
            |row| row.get(0),
        )?;
        if count == 0 {
            return Ok(true);
        }
    }
    Ok(!attachment_lifecycle_ready(connection)?)
}

/// attachment 的三个生命周期列是否齐备。
fn attachment_lifecycle_ready(connection: &Connection) -> AppResult<bool> {
    let columns: i64 = connection.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('attachment') WHERE name IN ('scope','expires_at','orphaned_at')",
        [],
        |row| row.get(0),
    )?;
    Ok(columns >= 3)
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

    // v10 与 v15 都重建 node 表：必须在事务外关闭外键，并禁止 SQLite 改写依赖表的 FK 名称。
    let rebuild_node = version < 15;
    if rebuild_node {
        connection.pragma_update(None, "foreign_keys", "OFF")?;
        connection.pragma_update(None, "legacy_alter_table", "ON")?;
    }

    let result = (|| -> AppResult<()> {
        let transaction = connection.transaction()?;
        if version < SCHEMA_VERSION {
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
            if version <= 10 {
                transaction.execute_batch(MIGRATION_V10_TO_V11)?;
            }
            if version <= 11 {
                transaction.execute_batch(MIGRATION_V11_TO_V12)?;
            }
            if version <= 12 {
                transaction.execute_batch(MIGRATION_V12_TO_V13)?;
            }
            if version <= 13 {
                transaction.execute_batch(MIGRATION_V13_TO_V14)?;
            }
            if version <= 14 {
                transaction.execute_batch(MIGRATION_V14_TO_V15)?;
            }
        }
        transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        if rebuild_node {
            // 悬空引用必须在提交前拦下：提交后再报错只会留下“版本已升级但数据是坏的”的库。
            let violations = foreign_key_violation_count(&transaction)?;
            if violations > 0 {
                logging::error(
                    "db.workspace",
                    &format!("工作区库迁移后存在 {violations} 条外键悬空引用"),
                );
                return Err(AppError::Internal);
            }
        }
        transaction.commit()?;
        Ok(())
    })();

    if rebuild_node {
        connection.pragma_update(None, "legacy_alter_table", "OFF")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
    }
    result?;

    if version < SCHEMA_VERSION {
        logging::info(
            "db.workspace",
            &format!("工作区库迁移完成，版本={SCHEMA_VERSION}"),
        );
    }
    Ok(())
}

/// 自愈补丁 · 附件节点引用表：只在缺失时创建（2026-10-26 真实现场）。
const REPAIR_NODE_ATTACHMENT: &str = r#"
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
"#;

/// 自愈补丁 · 工作区元数据表。
const REPAIR_WORKSPACE_META: &str = r#"
CREATE TABLE IF NOT EXISTS workspace_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
"#;

/// 自愈补丁 · 文档块元数据表（检索索引回填的前置依赖）。
/// 自愈补丁 · 思维导图表（与 V14→V15 中相同的幂等部分）。
const REPAIR_MINDMAP_TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS mindmap_scene (
    node_id         TEXT PRIMARY KEY NOT NULL,
    content_json    TEXT NOT NULL,
    content_version INTEGER NOT NULL DEFAULT 1,
    topic_count     INTEGER NOT NULL DEFAULT 1,
    updated_at      INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mindmap_viewport (
    node_id    TEXT PRIMARY KEY NOT NULL,
    x          REAL NOT NULL DEFAULT 0,
    y          REAL NOT NULL DEFAULT 0,
    zoom       REAL NOT NULL DEFAULT 1 CHECK (zoom > 0),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (node_id) REFERENCES node(id) ON DELETE CASCADE
);
"#;

/// 自愈补丁 · AI 协作表（待审区与审计）。
const REPAIR_AI_TABLES: &str = r#"
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
CREATE INDEX IF NOT EXISTS idx_ai_inbox_status_created
    ON ai_inbox(status, created_at DESC);
CREATE TABLE IF NOT EXISTS ai_audit (
    id         TEXT PRIMARY KEY NOT NULL,
    tool       TEXT NOT NULL,
    node_id    TEXT,
    summary    TEXT NOT NULL DEFAULT '',
    risk       TEXT NOT NULL,
    outcome    TEXT NOT NULL CHECK (outcome IN ('direct', 'inbox', 'approved', 'rejected', 'failed', 'denied')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_audit_created
    ON ai_audit(created_at DESC);
"#;

/// 检查表是否存在。
fn table_exists(transaction: &rusqlite::Transaction<'_>, name: &str) -> AppResult<bool> {
    let count: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// 读取表的全部列名。
fn table_columns(transaction: &rusqlite::Transaction<'_>, table: &str) -> AppResult<Vec<String>> {
    let mut statement = transaction.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

/// 自愈：按 [`REQUIRED_STRUCTURES`] 补齐缺失的表/列。
///
/// 这些产物原本分散在基线 [`SCHEMA`] 与增量迁移里；由缺它们的构建新建的库会带着
/// 已经到顶的 `user_version` 跳过全部迁移，之后附件看门狗、检索、思维导图加载等
/// 一律报“数据库操作失败”。全部语句幂等，需要时会重复执行。
fn repair_schema_gaps(transaction: &rusqlite::Transaction<'_>) -> AppResult<()> {
    let mut repaired = false;

    let mut missing: Vec<&str> = Vec::new();
    for (table, _) in REQUIRED_STRUCTURES {
        if !table_exists(transaction, table)? {
            missing.push(table);
        }
    }
    // 基线表缺失：一次性执行整段 SCHEMA（全部 IF NOT EXISTS）。
    if REQUIRED_STRUCTURES
        .iter()
        .any(|(table, batch)| batch.is_none() && missing.contains(table))
    {
        transaction.execute_batch(SCHEMA)?;
        repaired = true;
    }
    // 迁移期产物：同一段 DDL 覆盖的表里任缺一张就跑一次。
    let mut batches: Vec<&str> = Vec::new();
    for (_, batch) in REQUIRED_STRUCTURES {
        let Some(batch) = batch else { continue };
        if batches.contains(batch) {
            continue;
        }
        batches.push(batch);
        let covers_missing = REQUIRED_STRUCTURES
            .iter()
            .any(|(name, candidate)| *candidate == Some(batch) && missing.contains(name));
        if covers_missing {
            transaction.execute_batch(batch)?;
            repaired = true;
        }
    }
    if table_exists(transaction, "attachment")? && !attachment_lifecycle_ready(transaction)? {
        let columns = table_columns(transaction, "attachment")?;
        let mut lifecycle = String::new();
        if !columns.iter().any(|column| column == "scope") {
            lifecycle.push_str(
                "ALTER TABLE attachment ADD COLUMN scope TEXT NOT NULL DEFAULT 'library' CHECK (scope IN ('library', 'node'));\n",
            );
        }
        if !columns.iter().any(|column| column == "expires_at") {
            lifecycle.push_str("ALTER TABLE attachment ADD COLUMN expires_at INTEGER;\n");
        }
        if !columns.iter().any(|column| column == "orphaned_at") {
            lifecycle.push_str("ALTER TABLE attachment ADD COLUMN orphaned_at INTEGER;\n");
        }
        if !lifecycle.is_empty() {
            transaction.execute_batch(&lifecycle)?;
            transaction.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_attachment_lifecycle
                 ON attachment(scope, status, orphaned_at, expires_at);",
            )?;
            repaired = true;
        }
    }

    if repaired {
        backfill_attachment_relations(transaction)?;
        logging::info(
            "db.workspace",
            "工作区库自愈完成：已补齐缺失的表/列并回填附件引用",
        );
    }
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

    let boards = if table_exists(transaction, "board_scene")? {
        let mut statement = transaction.prepare(
            "SELECT s.node_id, s.elements_json
             FROM board_scene s JOIN node n ON n.id = s.node_id
             WHERE n.type = 3",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    } else {
        // 自愈场景里画板表可能同样缺失；没有表就没有可回填的画板引用。
        Vec::new()
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
    fn repairs_v15_database_missing_v10_artifacts() {
        // 复刻 2026-10-26 真实现场：user_version 已到 15、缺 node_attachment/
        // workspace_meta/mindmap 表与 attachment 生命周期列，打开时必须自愈。
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        {
            let connection = Connection::open(&path).expect("创建残缺 v15 库");
            connection
                .execute_batch(
                    "CREATE TABLE knowledge_base (
                        id          TEXT PRIMARY KEY NOT NULL,
                        name        TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '',
                        sort_order  INTEGER NOT NULL DEFAULT 0,
                        created_at  INTEGER NOT NULL,
                        updated_at  INTEGER NOT NULL
                    );
                    CREATE TABLE node (
                        id                TEXT PRIMARY KEY NOT NULL,
                        type              INTEGER NOT NULL CHECK (type BETWEEN 1 AND 7),
                        title             TEXT NOT NULL,
                        knowledge_base_id TEXT NOT NULL,
                        parent_id         TEXT,
                        level             INTEGER NOT NULL CHECK (level >= 1),
                        path              TEXT NOT NULL,
                        sort_order        INTEGER NOT NULL DEFAULT 0,
                        starred           INTEGER NOT NULL DEFAULT 0,
                        word_count        INTEGER NOT NULL DEFAULT 0,
                        content           TEXT NOT NULL DEFAULT '',
                        doc_version       INTEGER NOT NULL DEFAULT 0,
                        create_time       INTEGER NOT NULL,
                        update_time       INTEGER NOT NULL,
                        deleted_at        INTEGER,
                        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_base(id) ON DELETE CASCADE,
                        FOREIGN KEY (parent_id) REFERENCES node(id) ON DELETE CASCADE
                    );
                    CREATE TABLE attachment (
                        id           TEXT PRIMARY KEY NOT NULL,
                        name         TEXT NOT NULL,
                        logical_path TEXT NOT NULL,
                        content_hash TEXT NOT NULL,
                        size         INTEGER NOT NULL,
                        mime         TEXT NOT NULL,
                        status       TEXT NOT NULL,
                        created_at   INTEGER NOT NULL,
                        updated_at   INTEGER NOT NULL,
                        deleted_at   INTEGER
                    );
                    INSERT INTO knowledge_base (id, name, created_at, updated_at)
                        VALUES ('kb1', '残缺库', 1, 1);
                    INSERT INTO attachment (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at)
                        VALUES ('att1', '旧附件', 'p', 'h', 1, 'text/plain', 'active', 1, 1);
                    PRAGMA user_version = 15;",
                )
                .expect("残缺 v15 结构");
        }
        let _ = crate::logging::init(&directory.path().join("logs"));
        let connection = match open(&path) {
            Ok(connection) => connection,
            Err(error) => {
                let log = std::fs::read_to_string(directory.path().join("logs/starris.log"))
                    .unwrap_or_default();
                panic!("打开残缺库应触发自愈: {error:?}\nLOG:\n{log}");
            }
        };

        let repaired: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
                 AND name IN ('node_attachment', 'workspace_meta', 'mindmap_scene', 'mindmap_viewport')",
                [],
                |row| row.get(0),
            )
            .expect("自愈后表数量");
        assert_eq!(repaired, 4, "缺失的 4 张表都应补齐");

        let scope: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('attachment') WHERE name = 'scope'",
                [],
                |row| row.get(0),
            )
            .expect("scope 列");
        assert_eq!(scope, 1, "attachment.scope 应补齐");

        connection
            .execute(
                "INSERT INTO node (id, type, title, knowledge_base_id, level, path, create_time, update_time)
                 VALUES ('n1', 7, '导图', 'kb1', 1, '/导图', 1, 1)",
                [],
            )
            .expect("节点应可写");
        connection
            .execute(
                "INSERT INTO node_attachment (node_id, object_id, created_at, updated_at)
                 VALUES ('n1', 'att1', 1, 1)",
                [],
            )
            .expect("node_attachment 应可写");
        connection
            .execute(
                "INSERT INTO workspace_meta (key, value) VALUES ('k', 'v')",
                [],
            )
            .expect("workspace_meta 应可写");
        connection
            .execute("INSERT INTO mindmap_scene (node_id, content_json, updated_at) VALUES ('n1', '{}', 1)", [])
            .expect("mindmap_scene 应可写");
    }

    #[test]
    fn initialization_tasks_run_in_priority_order_and_make_schema_ready() {
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        // 轻量连接：不建表，模拟“启动时尚未初始化”的库
        let mut connection = open_connection(&path).expect("轻量连接");
        assert!(
            needs_initialization(&connection).expect("检查"),
            "空库应判定需要初始化"
        );

        let executed = initialize_workspace(&mut connection, &path).expect("执行登记任务");
        assert_eq!(
            executed,
            vec!["schema-version", "structure-repair"],
            "任务按优先级执行"
        );
        assert!(
            !needs_initialization(&connection).expect("复查"),
            "初始化后不应再需要初始化"
        );

        let tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('node','attachment','node_attachment','workspace_meta','search_index',
                  'doc_history','mindmap_scene','ai_inbox')",
                [],
                |row| row.get(0),
            )
            .expect("表统计");
        assert_eq!(tables, 8, "登记任务应一次建齐核心表");

        // 已就绪的库再次走业务路径：ensure 只做检查，不报错
        ensure_initialized(&mut connection, &path).expect("已就绪库应直接通过");
    }

    #[test]
    fn ensure_initialized_repairs_drifted_v15_database() {
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        {
            let connection = Connection::open(&path).expect("创建残缺库");
            connection
                .execute_batch(
                    "CREATE TABLE knowledge_base (
                        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
                        description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
                        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE node (
                        id TEXT PRIMARY KEY NOT NULL, type INTEGER NOT NULL,
                        title TEXT NOT NULL, knowledge_base_id TEXT NOT NULL, parent_id TEXT,
                        level INTEGER NOT NULL, path TEXT NOT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0,
                        word_count INTEGER NOT NULL DEFAULT 0, content TEXT NOT NULL DEFAULT '',
                        create_time INTEGER NOT NULL, update_time INTEGER NOT NULL, deleted_at INTEGER
                    );
                    CREATE TABLE attachment (
                        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
                        logical_path TEXT NOT NULL, content_hash TEXT NOT NULL,
                        size INTEGER NOT NULL, mime TEXT NOT NULL, status TEXT NOT NULL,
                        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
                    );
                    INSERT INTO attachment
                        (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at)
                        VALUES ('att1', '旧附件', 'p', 'h', 1, 'text/plain', 'active', 1, 1);
                    PRAGMA user_version = 15;",
                )
                .expect("残缺结构");
        }
        let mut connection = open_connection(&path).expect("轻量连接");
        assert!(
            needs_initialization(&connection).expect("检查"),
            "缺表应判定需要初始化"
        );
        ensure_initialized(&mut connection, &path).expect("业务路径触发登记任务");
        ensure_initialized(&mut connection, &path).expect("修复后应直接通过");
        assert!(
            !needs_initialization(&connection).expect("复查"),
            "修复后不再需要初始化"
        );
    }

    #[test]
    fn ensure_initialized_repairs_every_registered_structure() {
        // 统一清单回归：无论缺的是基线表（doc_block_meta）还是迁移期产物
        // （search_index / doc_history / mindmap_viewport / ai_audit），
        // 初始化门与自愈都必须一致地判定并补齐。
        let directory = tempdir().expect("临时目录");
        let path = directory.path().join("workspace.sqlite3");
        {
            let connection = open(&path).expect("建立完整库");
            connection
                .execute_batch(
                    "DROP TABLE search_index;
                     DROP TABLE doc_history;
                     DROP TABLE mindmap_viewport;
                     DROP TABLE doc_block_meta;
                     DROP TABLE ai_audit;",
                )
                .expect("制造多组漂移");
        }
        let mut connection = open_connection(&path).expect("轻量连接");
        assert!(
            needs_initialization(&connection).expect("检查"),
            "缺任一登记结构都应判定需要初始化"
        );
        ensure_initialized(&mut connection, &path).expect("登记任务补齐");
        for table in [
            "search_index",
            "doc_history",
            "mindmap_viewport",
            "doc_block_meta",
            "ai_audit",
        ] {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("查询表");
            assert_eq!(count, 1, "{table} 应被自愈补齐");
        }
        assert!(
            !needs_initialization(&connection).expect("复查"),
            "补齐后不再需要初始化"
        );
    }

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
        assert_eq!(version, 15, "迁移必须停在 v15");

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

    /// 创建一个最小 v9 工作区库，供迁移备份测试复用。
    fn create_v9_database(path: &Path) {
        let connection = Connection::open(path).expect("创建 v9 库");
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
                 VALUES ('doc1', 2, '备份文档', 'kb1', NULL, 1, '/备份文档', 0, 0, 0, '', 1, 1);"#,
            )
            .expect("写入 v9 数据");
    }

    #[test]
    fn bundled_sqlite_supports_fts5_trigram() {
        let connection = Connection::open_in_memory().expect("内存库");
        connection
            .execute_batch("CREATE VIRTUAL TABLE search_probe USING fts5(body, tokenize='trigram')")
            .expect("bundled SQLite 必须支持 FTS5 trigram");
        connection
            .execute("INSERT INTO search_probe(body) VALUES ('星屿检索验证')", [])
            .expect("写入检索探针");
        let count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM search_probe WHERE search_probe MATCH '检索验'",
                [],
                |row| row.get(0),
            )
            .expect("trigram 子串检索");
        assert_eq!(count, 1);
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
        assert_eq!(version, 15);

        let doc_version: i64 = connection
            .query_row(
                "SELECT doc_version FROM node WHERE id = 'doc1'",
                [],
                |row| row.get(0),
            )
            .expect("v11 文档版本列");
        assert_eq!(doc_version, 0, "旧文档默认版本为 0");

        let indexed: i64 = connection
            .query_row("SELECT COUNT(*) FROM search_index", [], |row| row.get(0))
            .expect("检索索引回填");
        assert_eq!(indexed, 2, "迁移必须为已有节点建立索引");
        let matched: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM node_search WHERE node_search MATCH 'Doc'",
                [],
                |row| row.get(0),
            )
            .expect("FTS 索引可检索");
        assert_eq!(matched, 1);

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
    fn migration_backup_is_created_once_and_remains_readable() {
        let directory = tempdir().expect("临时目录");
        let db_dir = directory.path().join("db");
        fs::create_dir_all(&db_dir).expect("db 目录");
        let path = db_dir.join("workspace.sqlite3");
        create_v9_database(&path);

        let connection = open(&path).expect("迁移打开");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, 15);

        let backup_dir = db_dir.join(BACKUP_DIR);
        let backups: Vec<PathBuf> = fs::read_dir(&backup_dir)
            .expect("备份目录")
            .map(|entry| entry.expect("备份项").path())
            .collect();
        assert_eq!(backups.len(), 1, "旧库升级必须生成一份备份");
        let backup = Connection::open(&backups[0]).expect("备份可打开");
        let title: String = backup
            .query_row("SELECT title FROM node WHERE id = 'doc1'", [], |row| {
                row.get(0)
            })
            .expect("备份保留旧数据");
        assert_eq!(title, "备份文档");

        // 已是 v11 再打开不重复备份。
        drop(backup);
        drop(connection);
        drop(open(&path).expect("再次打开"));
        assert_eq!(
            fs::read_dir(&backup_dir).expect("备份目录").count(),
            1,
            "最新版本不得重复备份"
        );
    }

    #[test]
    fn migration_backup_failure_aborts_upgrade() {
        let directory = tempdir().expect("临时目录");
        let db_dir = directory.path().join("db");
        fs::create_dir_all(&db_dir).expect("db 目录");
        let path = db_dir.join("workspace.sqlite3");
        create_v9_database(&path);
        // 用普通文件占住 backups 路径，让备份目录创建失败。
        fs::write(db_dir.join(BACKUP_DIR), b"not a directory").expect("占位文件");

        assert!(open(&path).is_err(), "备份失败必须中止迁移");
        let connection = Connection::open(&path).expect("原库仍可打开");
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读版本");
        assert_eq!(version, 9, "备份失败不得修改原库版本");
    }

    #[test]
    fn prune_backups_keeps_latest_three() {
        let directory = tempdir().expect("临时目录");
        for index in 0..5 {
            fs::write(
                directory
                    .path()
                    .join(format!("workspace-v9-{index}.sqlite3")),
                b"backup",
            )
            .expect("写入备份");
        }
        prune_backups(directory.path(), BACKUP_KEEP).expect("清理备份");
        assert_eq!(
            fs::read_dir(directory.path()).expect("备份目录").count(),
            BACKUP_KEEP
        );
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
        assert_eq!(version, 15, "v8 库必须升到 v15");

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
