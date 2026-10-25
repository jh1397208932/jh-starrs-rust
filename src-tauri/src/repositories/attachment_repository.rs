//! 附件逻辑元数据、物理对象与 pack 的 SQL 访问。
//!
//! 仓储只做 SQL 与行映射；引用计数的事务编排由 attachment_service 负责。

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::models::attachment::{
    AttachmentBlobRow, AttachmentListQuery, AttachmentPackRow, AttachmentRow,
};

/// 映射 attachment 行。
fn map_attachment(row: &Row<'_>) -> rusqlite::Result<AttachmentRow> {
    Ok(AttachmentRow {
        id: row.get(0)?,
        name: row.get(1)?,
        logical_path: row.get(2)?,
        content_hash: row.get(3)?,
        size: row.get(4)?,
        mime: row.get(5)?,
        status: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        deleted_at: row.get(9)?,
        scope: row.get(10)?,
        expires_at: row.get(11)?,
        orphaned_at: row.get(12)?,
        reference_count: row.get(13)?,
    })
}

/// 映射 attachment_blob 行。
fn map_blob(row: &Row<'_>) -> rusqlite::Result<AttachmentBlobRow> {
    Ok(AttachmentBlobRow {
        hash: row.get(0)?,
        size: row.get(1)?,
        storage_kind: row.get(2)?,
        pack_id: row.get(3)?,
        pack_offset: row.get(4)?,
        created_at: row.get(5)?,
    })
}

/// 映射 attachment_pack 行。
fn map_pack(row: &Row<'_>) -> rusqlite::Result<AttachmentPackRow> {
    Ok(AttachmentPackRow {
        id: row.get(0)?,
        file_name: row.get(1)?,
        size: row.get(2)?,
        active: row.get::<_, i64>(3)? == 1,
        created_at: row.get(4)?,
        retired_at: row.get(5)?,
    })
}

const ATTACHMENT_COLUMNS: &str = "id, name, logical_path, content_hash, size, mime, status,
    created_at, updated_at, deleted_at, scope, expires_at, orphaned_at,
    (SELECT COUNT(*) FROM node_attachment r WHERE r.object_id = attachment.id) AS reference_count";
const BLOB_COLUMNS: &str = "hash, size, storage_kind, pack_id, pack_offset, created_at";
const PACK_COLUMNS: &str = "id, file_name, size, active, created_at, retired_at";

/// 查询活跃附件（软删除行不可见）。
pub fn find_active(connection: &Connection, id: &str) -> rusqlite::Result<Option<AttachmentRow>> {
    connection
        .query_row(
            &format!(
                "SELECT {ATTACHMENT_COLUMNS} FROM attachment WHERE id = ?1 AND status = 'active'"
            ),
            [id],
            map_attachment,
        )
        .optional()
}

/// 插入逻辑附件。
pub fn insert_attachment(connection: &Connection, row: &AttachmentRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO attachment
            (id, name, logical_path, content_hash, size, mime, status, created_at, updated_at,
             deleted_at, scope, expires_at, orphaned_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            row.id,
            row.name,
            row.logical_path,
            row.content_hash,
            row.size,
            row.mime,
            row.status,
            row.created_at,
            row.updated_at,
            row.deleted_at,
            row.scope,
            row.expires_at,
            row.orphaned_at,
        ],
    )?;
    Ok(())
}

/// 只更新活跃附件的名称/逻辑路径；None 表示保持原值。
pub fn update_attachment_meta(
    connection: &Connection,
    id: &str,
    name: Option<&str>,
    logical_path: Option<&str>,
    updated_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE attachment
         SET name = COALESCE(?2, name),
             logical_path = COALESCE(?3, logical_path),
             updated_at = ?4
         WHERE id = ?1 AND status = 'active'",
        params![id, name, logical_path, updated_at],
    )
}

/// 软删除活跃附件；保留物理对象以便恢复。
pub fn mark_deleted(connection: &Connection, id: &str, deleted_at: i64) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE attachment
         SET status = 'deleted', deleted_at = ?2, updated_at = ?2
         WHERE id = ?1 AND status = 'active'",
        params![id, deleted_at],
    )
}

/// 从回收站恢复附件；内容不存在时仍恢复行，由后续校验提示。
pub fn restore(connection: &Connection, id: &str, updated_at: i64) -> rusqlite::Result<usize> {
    connection.execute(
        // 恢复后没有业务引用，转为主动保留的 library，避免下轮维护再次判孤儿。
        "UPDATE attachment
         SET status = 'active', deleted_at = NULL, orphaned_at = NULL,
             scope = 'library', expires_at = NULL, updated_at = ?2
         WHERE id = ?1 AND status = 'deleted'",
        params![id, updated_at],
    )
}

/// 永久删除附件行（调用方负责随后判断物理对象是否可删）。
pub fn purge_row(connection: &Connection, id: &str) -> rusqlite::Result<usize> {
    connection.execute("DELETE FROM attachment WHERE id = ?1", [id])
}

/// 按 id 查询任意状态（回收站恢复/purge 使用）。
pub fn find_any(connection: &Connection, id: &str) -> rusqlite::Result<Option<AttachmentRow>> {
    connection
        .query_row(
            &format!("SELECT {ATTACHMENT_COLUMNS} FROM attachment WHERE id = ?1"),
            [id],
            map_attachment,
        )
        .optional()
}

/// 设置附件临时保留时间；None 清除。
pub fn set_expires_at(
    connection: &Connection,
    id: &str,
    expires_at: Option<i64>,
    updated_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE attachment SET expires_at = ?2, updated_at = ?3
         WHERE id = ?1 AND status = 'active'",
        params![id, expires_at, updated_at],
    )
}

/// 统计同哈希的附件行数（含回收站）；0 才能删除物理对象。
pub fn count_hash_rows(connection: &Connection, hash: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM attachment WHERE content_hash = ?1",
        [hash],
        |row| row.get(0),
    )
}

/// 列出附件；可按逻辑目录过滤，并可包含软删除行。
pub fn list(
    connection: &Connection,
    query: &AttachmentListQuery,
) -> rusqlite::Result<Vec<AttachmentRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {ATTACHMENT_COLUMNS} FROM attachment
         WHERE (?1 IS NULL OR logical_path = ?1)
           AND (?2 = 1 OR status = 'active')
         ORDER BY updated_at DESC, created_at DESC, id DESC"
    ))?;
    let rows = statement.query_map(
        params![
            query.logical_path.as_deref(),
            i64::from(query.include_deleted)
        ],
        map_attachment,
    )?;
    rows.collect()
}

/// 按哈希读取物理对象行。
pub fn find_blob(
    connection: &Connection,
    hash: &str,
) -> rusqlite::Result<Option<AttachmentBlobRow>> {
    connection
        .query_row(
            &format!("SELECT {BLOB_COLUMNS} FROM attachment_blob WHERE hash = ?1"),
            [hash],
            map_blob,
        )
        .optional()
}

/// 插入物理对象行；调用方负责在同一事务里插入逻辑附件。
pub fn insert_blob(connection: &Connection, row: &AttachmentBlobRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO attachment_blob
            (hash, size, storage_kind, pack_id, pack_offset, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            row.hash,
            row.size,
            row.storage_kind,
            row.pack_id,
            row.pack_offset,
            row.created_at,
        ],
    )?;
    Ok(())
}

/// 统计还有多少条活跃逻辑附件引用该哈希。
///
/// 这是"物理对象该不该存在"的唯一判据，取代了原先冗余的 `ref_count` 列；
/// 走 `idx_attachment_hash`，0 表示可以删对象与 blob 行。
#[cfg(test)]
pub fn count_active_references(connection: &Connection, hash: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM attachment WHERE content_hash = ?1 AND status = 'active'",
        [hash],
        |row| row.get(0),
    )
}

/// 列出全部物理对象索引（维护任务与磁盘统计使用）。
pub fn list_blobs(connection: &Connection) -> rusqlite::Result<Vec<AttachmentBlobRow>> {
    let mut statement =
        connection.prepare(&format!("SELECT {BLOB_COLUMNS} FROM attachment_blob"))?;
    let rows = statement.query_map([], map_blob)?;
    rows.collect()
}

/// 列出全部 pack。
pub fn list_packs(connection: &Connection) -> rusqlite::Result<Vec<AttachmentPackRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {PACK_COLUMNS} FROM attachment_pack ORDER BY created_at, id"
    ))?;
    let rows = statement.query_map([], map_pack)?;
    rows.collect()
}

/// 列出超过宽限期且无引用的 node 孤儿。
pub fn list_orphaned_before(
    connection: &Connection,
    cutoff: i64,
) -> rusqlite::Result<Vec<AttachmentRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {ATTACHMENT_COLUMNS} FROM attachment
         WHERE scope = 'node' AND status = 'active'
           AND orphaned_at IS NOT NULL AND orphaned_at <= ?1
           AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = attachment.id)
         ORDER BY orphaned_at"
    ))?;
    let rows = statement.query_map([cutoff], map_attachment)?;
    rows.collect()
}

/// 列出 TTL 到期且无引用的附件。
pub fn list_expired(connection: &Connection, now: i64) -> rusqlite::Result<Vec<AttachmentRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {ATTACHMENT_COLUMNS} FROM attachment
         WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?1
           AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = attachment.id)
         ORDER BY expires_at"
    ))?;
    let rows = statement.query_map([now], map_attachment)?;
    rows.collect()
}

/// 列出回收站超过保留期的附件。
pub fn list_trash_before(
    connection: &Connection,
    cutoff: i64,
) -> rusqlite::Result<Vec<AttachmentRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {ATTACHMENT_COLUMNS} FROM attachment
         WHERE status = 'deleted' AND deleted_at IS NOT NULL AND deleted_at <= ?1
         ORDER BY deleted_at"
    ))?;
    let rows = statement.query_map([cutoff], map_attachment)?;
    rows.collect()
}

/// 读取工作区维护元数据。
pub fn get_meta(connection: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM workspace_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
}

/// 写入工作区维护元数据。
pub fn set_meta(connection: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO workspace_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// 删除物理对象行。
pub fn delete_blob(connection: &Connection, hash: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM attachment_blob WHERE hash = ?1", [hash])?;
    Ok(())
}

/// 查询活跃 pack。
pub fn find_active_pack(connection: &Connection) -> rusqlite::Result<Option<AttachmentPackRow>> {
    connection
        .query_row(
            &format!("SELECT {PACK_COLUMNS} FROM attachment_pack WHERE active = 1 LIMIT 1"),
            [],
            map_pack,
        )
        .optional()
}

/// 按 id 查询 pack。
pub fn find_pack(connection: &Connection, id: &str) -> rusqlite::Result<Option<AttachmentPackRow>> {
    connection
        .query_row(
            &format!("SELECT {PACK_COLUMNS} FROM attachment_pack WHERE id = ?1"),
            [id],
            map_pack,
        )
        .optional()
}

/// 插入 pack 行。
pub fn insert_pack(connection: &Connection, row: &AttachmentPackRow) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO attachment_pack (id, file_name, size, active, created_at, retired_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            row.id,
            row.file_name,
            row.size,
            i64::from(row.active),
            row.created_at,
            row.retired_at,
        ],
    )?;
    Ok(())
}

/// 切换 pack 是否接收新追加。
pub fn set_pack_active(
    connection: &Connection,
    id: &str,
    active: bool,
    retired_at: Option<i64>,
) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE attachment_pack SET active = ?2, retired_at = ?3 WHERE id = ?1",
        params![id, i64::from(active), retired_at],
    )?;
    Ok(())
}

/// 更新 pack 的已写入长度。
pub fn update_pack_size(connection: &Connection, id: &str, size: i64) -> rusqlite::Result<()> {
    connection.execute(
        "UPDATE attachment_pack SET size = ?2 WHERE id = ?1",
        params![id, size],
    )?;
    Ok(())
}

/// 删除无引用的 pack 行。
pub fn delete_pack(connection: &Connection, id: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM attachment_pack WHERE id = ?1", [id])?;
    Ok(())
}

/// pack 内已索引条目的最大结束位置；用于截掉崩溃遗留的未索引尾部。
pub fn max_indexed_end(connection: &Connection, pack_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COALESCE(MAX(pack_offset + size), 0)
         FROM attachment_blob
         WHERE pack_id = ?1",
        [pack_id],
        |row| row.get(0),
    )
}

/// pack 内活跃条目的字节数总和。
///
/// blob 行只在被活跃附件引用期间存在（删除时引用归零即删行），所以此处不需要额外过滤。
pub fn live_bytes_in_pack(connection: &Connection, pack_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COALESCE(SUM(size), 0)
         FROM attachment_blob
         WHERE pack_id = ?1",
        [pack_id],
        |row| row.get(0),
    )
}

/// 列出 pack 内仍活跃的物理对象。
pub fn list_live_blobs_in_pack(
    connection: &Connection,
    pack_id: &str,
) -> rusqlite::Result<Vec<AttachmentBlobRow>> {
    let mut statement = connection.prepare(&format!(
        "SELECT {BLOB_COLUMNS} FROM attachment_blob
         WHERE pack_id = ?1
         ORDER BY pack_offset ASC"
    ))?;
    let rows = statement.query_map([pack_id], map_blob)?;
    rows.collect()
}

/// 把仍指向旧位置的 blob 条件更新到新 pack；返回是否更新。
pub fn move_blob_to_pack(
    connection: &Connection,
    hash: &str,
    old_pack_id: &str,
    old_offset: i64,
    new_pack_id: &str,
    new_offset: i64,
) -> rusqlite::Result<bool> {
    let changed = connection.execute(
        "UPDATE attachment_blob
         SET pack_id = ?4, pack_offset = ?5
         WHERE hash = ?1 AND pack_id = ?2 AND pack_offset = ?3
           AND ?2 <> ?4",
        params![hash, old_pack_id, old_offset, new_pack_id, new_offset],
    )?;
    Ok(changed == 1)
}

/// 某 pack 是否仍被 blob 引用。
pub fn count_blobs_in_pack(connection: &Connection, pack_id: &str) -> rusqlite::Result<i64> {
    connection.query_row(
        "SELECT COUNT(*) FROM attachment_blob WHERE pack_id = ?1",
        [pack_id],
        |row| row.get(0),
    )
}

/// 附件统计基础数据；死 pack 字节由 pack_stats 补充。
pub struct StatsBase {
    pub active_count: i64,
    pub deleted_count: i64,
    pub logical_bytes: i64,
    pub unique_objects: i64,
    pub physical_bytes: i64,
    pub big_objects: i64,
    pub pack_objects: i64,
    pub pack_count: i64,
    pub pack_bytes: i64,
    pub linked_count: i64,
    pub unlinked_count: i64,
    pub trash_count: i64,
    pub trash_bytes: i64,
    pub orphan_bytes: i64,
}

/// 一次查询所有统计值。
pub fn stats(connection: &Connection) -> rusqlite::Result<StatsBase> {
    connection.query_row(
        "SELECT
            (SELECT COUNT(*) FROM attachment WHERE status = 'active'),
            (SELECT COUNT(*) FROM attachment WHERE status = 'deleted'),
            (SELECT COALESCE(SUM(size), 0) FROM attachment WHERE status = 'active'),
            (SELECT COUNT(*) FROM attachment_blob),
            (SELECT COALESCE(SUM(size), 0) FROM attachment_blob),
            (SELECT COUNT(*) FROM attachment_blob WHERE storage_kind = 'big'),
            (SELECT COUNT(*) FROM attachment_blob WHERE storage_kind = 'pack'),
            (SELECT COUNT(*) FROM attachment_pack),
            (SELECT COALESCE(SUM(size), 0) FROM attachment_pack),
            (SELECT COUNT(*) FROM attachment a
               WHERE a.status = 'active'
                 AND EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = a.id)),
            (SELECT COUNT(*) FROM attachment a
               WHERE a.status = 'active'
                 AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = a.id)),
            (SELECT COUNT(*) FROM attachment WHERE status = 'deleted'),
            (SELECT COALESCE(SUM(size), 0) FROM attachment WHERE status = 'deleted'),
            (SELECT COALESCE(SUM(size), 0) FROM attachment a
               WHERE a.status = 'active' AND a.scope = 'node'
                 AND NOT EXISTS (SELECT 1 FROM node_attachment r WHERE r.object_id = a.id))",
        [],
        |row| {
            Ok(StatsBase {
                active_count: row.get(0)?,
                deleted_count: row.get(1)?,
                logical_bytes: row.get(2)?,
                unique_objects: row.get(3)?,
                physical_bytes: row.get(4)?,
                big_objects: row.get(5)?,
                pack_objects: row.get(6)?,
                pack_count: row.get(7)?,
                pack_bytes: row.get(8)?,
                linked_count: row.get(9)?,
                unlinked_count: row.get(10)?,
                trash_count: row.get(11)?,
                trash_bytes: row.get(12)?,
                orphan_bytes: row.get(13)?,
            })
        },
    )
}
