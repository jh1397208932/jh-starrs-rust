//! 文档派生元数据：Markdown 与属性 JSON 的生成、异步写入。
//!
//! 正文保存是权威事务；元数据是派生数据，允许短暂滞后。后台线程使用独立连接
//! 写同一个工作区库（WAL + busy_timeout），失败只记录日志，下一次保存会重试。

use std::path::Path;
use std::thread;

use serde_json::Value;

use crate::db;
use crate::domain::document::{document_props, to_markdown};
use crate::errors::AppResult;
use crate::logging;
use crate::repositories::document_repository;

/// 一次元数据写入载荷；构造后不可变，可安全移入后台线程。
#[derive(Debug, Clone)]
pub struct DocMetaPayload {
    pub node_id: String,
    pub markdown: String,
    pub prop: String,
    /// 派生数据对应的正文时间；晚到的旧任务不会覆盖新结果。
    pub update_time: i64,
}

impl DocMetaPayload {
    /// 从规范化文档生成载荷；`prop` 始终序列化为合法 JSON 字符串。
    pub fn from_document(node_id: &str, document: &Value, update_time: i64) -> Self {
        Self {
            node_id: node_id.to_string(),
            markdown: to_markdown(document),
            prop: document_props(document).to_string(),
            update_time,
        }
    }
}

/// 投递一次异步写入；线程创建失败不影响正文保存。
pub fn schedule_write(db_path: std::path::PathBuf, payload: DocMetaPayload) {
    let thread_name = format!("starris-doc-meta-{}", short_id(&payload.node_id));
    let spawned = thread::Builder::new().name(thread_name).spawn(move || {
        if let Err(error) = write_now(&db_path, &payload) {
            logging::error(
                "document.meta",
                &format!("异步写入文档元数据失败 node={}: {error}", payload.node_id),
            );
        }
    });
    if let Err(error) = spawned {
        logging::error("document.meta", &format!("启动元数据线程失败: {error}"));
    }
}

/// 同步写入（后台线程与测试共用）；数据库文件不存在时直接放弃。
pub fn write_now(db_path: &Path, payload: &DocMetaPayload) -> AppResult<()> {
    let connection = db::workspace::open_existing(db_path)?;
    document_repository::upsert_meta(
        &connection,
        &payload.node_id,
        &payload.markdown,
        &payload.prop,
        payload.update_time,
    )?;
    logging::debug(
        "document.meta",
        &format!(
            "文档元数据已写入 node={} markdown={}B prop={}B",
            payload.node_id,
            payload.markdown.len(),
            payload.prop.len()
        ),
    );
    Ok(())
}

/// 元数据缺失或与当前正文不一致时补写；加载旧文档时惰性补齐。
///
/// 派生文本与 prop 完全相同则不重复写，避免每次切标签都产生后台 IO。
pub fn backfill_if_missing(
    connection: &rusqlite::Connection,
    db_path: &Path,
    node_id: &str,
    document: &Value,
    update_time: i64,
) -> AppResult<()> {
    let payload = DocMetaPayload::from_document(node_id, document, update_time);
    if let Some((markdown, prop, _)) = document_repository::find_meta(connection, node_id)?
        && markdown == payload.markdown
        && prop == payload.prop
    {
        return Ok(());
    }
    schedule_write(db_path.to_path_buf(), payload);
    Ok(())
}

fn short_id(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}
