//! AI 协作的 SQL 访问：权限配置（workspace_meta）、待审区与审计日志。

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// 工作区内 AI 写权限配置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AiPermissions {
    /// 文档作用域：read-only / review / editable
    pub doc: String,
    /// 画板作用域
    pub board: String,
    /// 思维导图作用域
    pub mindmap: String,
}

impl Default for AiPermissions {
    fn default() -> Self {
        Self {
            doc: "review".to_string(),
            board: "review".to_string(),
            mindmap: "review".to_string(),
        }
    }
}

/// 待审区一行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInboxRow {
    pub id: String,
    pub tool: String,
    pub node_id: Option<String>,
    pub payload_json: String,
    pub summary: String,
    pub risk: String,
    pub status: String,
    pub error: Option<String>,
    pub created_at: i64,
    pub decided_at: Option<i64>,
}

/// 审计一行。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAuditRow {
    pub id: String,
    pub tool: String,
    pub node_id: Option<String>,
    pub summary: String,
    pub risk: String,
    pub outcome: String,
    pub created_at: i64,
}

const PERMISSIONS_KEY: &str = "ai.permissions";

/// 读取 AI 权限配置；缺省回落到 review。
pub fn get_permissions(connection: &Connection) -> rusqlite::Result<AiPermissions> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT value FROM workspace_meta WHERE key = ?1",
            [PERMISSIONS_KEY],
            |row| row.get(0),
        )
        .optional()?;
    Ok(raw
        .and_then(|value| serde_json::from_str::<AiPermissions>(&value).ok())
        .unwrap_or_default())
}

/// 写入 AI 权限配置。
pub fn set_permissions(
    connection: &Connection,
    permissions: &AiPermissions,
) -> rusqlite::Result<()> {
    let value = serde_json::to_string(permissions).unwrap_or_else(|_| "{}".to_string());
    connection.execute(
        "INSERT INTO workspace_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![PERMISSIONS_KEY, value],
    )?;
    Ok(())
}

/// 新待审项的字段集合。
pub struct NewInboxItem<'a> {
    pub id: &'a str,
    pub tool: &'a str,
    pub node_id: Option<&'a str>,
    pub payload_json: &'a str,
    pub summary: &'a str,
    pub risk: &'a str,
    pub created_at: i64,
}

/// 写入一条待审项。
pub fn insert_inbox(connection: &Connection, item: NewInboxItem<'_>) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO ai_inbox (id, tool, node_id, payload_json, summary, risk, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        rusqlite::params![
            item.id,
            item.tool,
            item.node_id,
            item.payload_json,
            item.summary,
            item.risk,
            item.created_at
        ],
    )?;
    Ok(())
}

/// 列出待审项；status 为 None 时列出最近全部。
pub fn list_inbox(
    connection: &Connection,
    status: Option<&str>,
    limit: i64,
) -> rusqlite::Result<Vec<AiInboxRow>> {
    let limit = limit.clamp(1, 200);
    let mut statement = if status.is_some() {
        connection.prepare(
            "SELECT id, tool, node_id, payload_json, summary, risk, status, error, created_at, decided_at
             FROM ai_inbox WHERE status = ?1 ORDER BY created_at DESC LIMIT ?2",
        )?
    } else {
        connection.prepare(
            "SELECT id, tool, node_id, payload_json, summary, risk, status, error, created_at, decided_at
             FROM ai_inbox ORDER BY created_at DESC LIMIT ?2",
        )?
    };
    let rows = match status {
        Some(value) => statement.query_map(rusqlite::params![value, limit], read_inbox_row)?,
        None => statement.query_map(
            rusqlite::params![Option::<String>::None, limit],
            read_inbox_row,
        )?,
    };
    rows.collect()
}

fn read_inbox_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiInboxRow> {
    Ok(AiInboxRow {
        id: row.get(0)?,
        tool: row.get(1)?,
        node_id: row.get(2)?,
        payload_json: row.get(3)?,
        summary: row.get(4)?,
        risk: row.get(5)?,
        status: row.get(6)?,
        error: row.get(7)?,
        created_at: row.get(8)?,
        decided_at: row.get(9)?,
    })
}

/// 按 id 查询待审项。
pub fn find_inbox(connection: &Connection, id: &str) -> rusqlite::Result<Option<AiInboxRow>> {
    connection
        .query_row(
            "SELECT id, tool, node_id, payload_json, summary, risk, status, error, created_at, decided_at
             FROM ai_inbox WHERE id = ?1",
            [id],
            read_inbox_row,
        )
        .optional()
}

/// 更新待审项状态；返回受影响行数（0 表示状态不匹配或不存在）。
pub fn decide_inbox(
    connection: &Connection,
    id: &str,
    status: &str,
    error: Option<&str>,
    decided_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE ai_inbox SET status = ?2, error = ?3, decided_at = ?4
         WHERE id = ?1 AND status = 'pending'",
        rusqlite::params![id, status, error, decided_at],
    )
}

/// 原子认领待审项：只有把记录从 pending 改成 approved 的那次调用会成功。
///
/// 审批入口先在这里“抢锁”，避免双击或并发审批把同一条写入执行两次。
pub fn claim_inbox(connection: &Connection, id: &str, decided_at: i64) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE ai_inbox SET status = 'approved', decided_at = ?2
         WHERE id = ?1 AND status = 'pending'",
        rusqlite::params![id, decided_at],
    )
}

/// 已认领的审批执行失败：标记为 failed（不限制原状态，认领后记录已是 approved）。
pub fn fail_inbox(
    connection: &Connection,
    id: &str,
    error: &str,
    decided_at: i64,
) -> rusqlite::Result<usize> {
    connection.execute(
        "UPDATE ai_inbox SET status = 'failed', error = ?2, decided_at = ?3 WHERE id = ?1",
        rusqlite::params![id, error, decided_at],
    )
}

/// 新审计记录字段。
pub struct NewAuditItem<'a> {
    pub id: &'a str,
    pub tool: &'a str,
    pub node_id: Option<&'a str>,
    pub summary: &'a str,
    pub risk: &'a str,
    pub outcome: &'a str,
    pub created_at: i64,
}

/// 写入审计记录。
pub fn insert_audit(connection: &Connection, item: NewAuditItem<'_>) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO ai_audit (id, tool, node_id, summary, risk, outcome, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            item.id,
            item.tool,
            item.node_id,
            item.summary,
            item.risk,
            item.outcome,
            item.created_at
        ],
    )?;
    Ok(())
}

/// 列出最近审计记录。
pub fn list_audit(connection: &Connection, limit: i64) -> rusqlite::Result<Vec<AiAuditRow>> {
    let limit = limit.clamp(1, 200);
    let mut statement = connection.prepare(
        "SELECT id, tool, node_id, summary, risk, outcome, created_at
         FROM ai_audit ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = statement.query_map([limit], |row| {
        Ok(AiAuditRow {
            id: row.get(0)?,
            tool: row.get(1)?,
            node_id: row.get(2)?,
            summary: row.get(3)?,
            risk: row.get(4)?,
            outcome: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;
    rows.collect()
}
