//! 文档历史快照仓储：按时间间隔写入，单篇最多保留 50 份。

use rusqlite::{Connection, OptionalExtension, params};

use crate::models::history::DocHistorySummary;
use crate::utils::new_id;

/// 快照最小间隔：10 分钟；首次保存也写一份。
const SNAPSHOT_INTERVAL_MS: i64 = 10 * 60 * 1000;
/// 单篇文档保留份数。
const SNAPSHOT_KEEP: i64 = 50;
/// 单篇文档历史快照的总字节预算；超出时从最旧开始删，至少保留 1 份。
///
/// 只按份数裁剪时，一篇 2 MiB 的正文最多会留下 100 MiB 历史，长文反复编辑会把工作区库撑大。
const SNAPSHOT_BYTES_BUDGET: i64 = 16 * 1024 * 1024;

/// 按间隔写快照并裁剪；返回是否写入。
pub fn maybe_snapshot(
    connection: &Connection,
    node_id: &str,
    content: &str,
    word_count: i64,
    now: i64,
) -> rusqlite::Result<bool> {
    let last: Option<i64> = connection
        .query_row(
            "SELECT MAX(created_at) FROM doc_history WHERE node_id = ?1",
            [node_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    if last.is_some_and(|last| now.saturating_sub(last) < SNAPSHOT_INTERVAL_MS) {
        return Ok(false);
    }
    connection.execute(
        "INSERT INTO doc_history(id, node_id, content, word_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_id(), node_id, content, word_count, now],
    )?;
    connection.execute(
        "DELETE FROM doc_history
         WHERE node_id = ?1 AND id NOT IN (
             SELECT id FROM doc_history WHERE node_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2
         )",
        params![node_id, SNAPSHOT_KEEP],
    )?;
    trim_to_budget(connection, node_id)?;
    Ok(true)
}

/// 按总字节预算从最旧开始裁剪；最新一份无论多大都保留。
fn trim_to_budget(connection: &Connection, node_id: &str) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(
        "SELECT id, LENGTH(CAST(content AS BLOB)) FROM doc_history
         WHERE node_id = ?1 ORDER BY created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([node_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    let mut snapshots = Vec::new();
    for row in rows {
        snapshots.push(row?);
    }
    let mut total: i64 = snapshots.iter().map(|(_, size)| *size).sum();
    let mut remove = 0usize;
    while total > SNAPSHOT_BYTES_BUDGET && snapshots.len() - remove > 1 {
        total -= snapshots[remove].1;
        remove += 1;
    }
    for (id, _) in &snapshots[..remove] {
        connection.execute("DELETE FROM doc_history WHERE id = ?1", [id])?;
    }
    Ok(())
}

/// 列出历史快照（不含正文）。
pub fn list(
    connection: &Connection,
    node_id: &str,
    limit: i64,
) -> rusqlite::Result<Vec<DocHistorySummary>> {
    let mut statement = connection.prepare(
        "SELECT id, word_count, created_at FROM doc_history
         WHERE node_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![node_id, limit], |row| {
        Ok(DocHistorySummary {
            id: row.get(0)?,
            word_count: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// 读取快照正文；node_id 与 history_id 必须匹配，避免跨文档恢复。
pub fn find_content(
    connection: &Connection,
    node_id: &str,
    history_id: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "SELECT content FROM doc_history WHERE id = ?1 AND node_id = ?2",
            params![history_id, node_id],
            |row| row.get(0),
        )
        .optional()
}
