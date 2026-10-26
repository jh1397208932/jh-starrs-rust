//! 工作区检索服务：短词 LIKE 回退、长词 FTS5、空查询最近节点。

use crate::errors::{AppError, AppResult};
use crate::models::search::{NetworkItemDto, NodeNetworkDto, SearchHit, SearchNodesInput};
use crate::repositories::knowledge_base_repository as kb_repository;
use crate::repositories::node_repository;
use crate::repositories::search_repository::{self, NetworkRow, SearchRow};
use crate::state::AppState;

/// FTS5 trigram 能命中的最小字符数；更短走 LIKE。
const FTS_MIN_CHARS: usize = 3;
/// 单次检索/最近列表最大条数。
const MAX_LIMIT: i64 = 50;
/// 片段前后保留的字符数。
const SNIPPET_RADIUS: usize = 36;

/// 搜索当前知识库；`query` 为空时返回最近更新节点。
pub fn search(state: &AppState, input: SearchNodesInput) -> AppResult<Vec<SearchHit>> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let connection = &session.connection;
    kb_repository::find_by_id(connection, &input.knowledge_base_id)?
        .ok_or_else(|| AppError::not_found("知识库不存在"))?;
    let query = input.query.trim();
    let limit = input.limit.clamp(1, MAX_LIMIT);
    let rows = if query.is_empty() {
        search_repository::query_recent(connection, &input.knowledge_base_id, limit)?
    } else if query.chars().count() >= FTS_MIN_CHARS {
        let match_query = format!("\"{}\"", query.replace('"', "\"\""));
        match search_repository::query_fts(
            connection,
            &input.knowledge_base_id,
            &match_query,
            limit,
        ) {
            Ok(rows) => rows,
            // 用户输入的 FTS 语法异常时退回 LIKE，避免整次搜索失败。
            Err(error) => {
                crate::logging::error("search", &format!("FTS 查询失败: {error}"));
                search_repository::query_like(
                    connection,
                    &input.knowledge_base_id,
                    &like_pattern(query),
                    limit,
                )?
            }
        }
    } else {
        search_repository::query_like(
            connection,
            &input.knowledge_base_id,
            &like_pattern(query),
            limit,
        )?
    };

    Ok(rows.into_iter().map(|row| to_hit(row, query)).collect())
}

/// 知识网络：正文提到当前标题的文档 + 主题相近的文档；短标题不猜。
pub fn network(state: &AppState, node_id: &str) -> AppResult<NodeNetworkDto> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let connection = &session.connection;
    let node = node_repository::find_by_id(connection, node_id)?
        .ok_or_else(|| AppError::not_found("内容不存在"))?;
    let title = node.title.trim();
    if title.chars().count() < 2 {
        return Ok(NodeNetworkDto {
            backlinks: Vec::new(),
            related: Vec::new(),
        });
    }
    let pattern = like_pattern(title);
    let backlinks = search_repository::query_backlinks(
        connection,
        &node.knowledge_base_id,
        node_id,
        &pattern,
        6,
    )?;
    let related = search_repository::query_related(
        connection,
        &node.knowledge_base_id,
        node_id,
        &pattern,
        6,
    )?;
    Ok(NodeNetworkDto {
        backlinks: backlinks.into_iter().map(to_network_item).collect(),
        related: related.into_iter().map(to_network_item).collect(),
    })
}

fn to_network_item(row: NetworkRow) -> NetworkItemDto {
    NetworkItemDto {
        id: row.node_id,
        title: row.title,
        kb_name: row.kb_name,
        node_type: row.node_type,
    }
}

fn to_hit(row: SearchRow, query: &str) -> SearchHit {
    let snippet = if row.snippet.is_empty() {
        make_snippet(&row.body, query)
    } else {
        row.snippet.trim().to_string()
    };
    SearchHit {
        node_id: row.node_id,
        title: row.title,
        kb_id: row.kb_id,
        kb_name: row.kb_name,
        node_type: row.node_type,
        snippet,
        updated_at: row.updated_at,
    }
}

/// LIKE 模式转义：反斜杠、百分号、下划线都要按字面匹配。
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// 从正文中截取查询附近的片段；找不到时返回开头一段。
fn make_snippet(body: &str, query: &str) -> String {
    if body.trim().is_empty() {
        return String::new();
    }
    let body_chars: Vec<char> = body.chars().collect();
    let query_lower = query.to_lowercase();
    let body_lower = body.to_lowercase();
    let byte_index = if query.is_empty() {
        None
    } else {
        body_lower.find(&query_lower)
    };
    let char_index = byte_index
        .map(|index| body[..index].chars().count())
        .unwrap_or(0);
    let start = char_index.saturating_sub(SNIPPET_RADIUS);
    let end = (char_index + query.chars().count() + SNIPPET_RADIUS).min(body_chars.len());
    let mut snippet: String = body_chars[start..end].iter().collect();
    if start > 0 {
        snippet.insert(0, '…');
    }
    if end < body_chars.len() {
        snippet.push('…');
    }
    snippet.replace('\n', " ").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern("100%_a"), "%100\\%\\_a%");
    }

    #[test]
    fn snippet_centers_query_and_elides() {
        let body = "前".repeat(100) + "关键内容" + &"后".repeat(100);
        let snippet = make_snippet(&body, "关键内容");
        assert!(snippet.contains("关键内容"));
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
    }
}
