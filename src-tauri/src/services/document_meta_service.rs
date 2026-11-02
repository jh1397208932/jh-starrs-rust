//! 文档派生元数据：Markdown 与属性 JSON 的生成、异步写入。
//!
//! 正文保存是权威事务；元数据是派生数据，允许短暂滞后。后台线程使用独立连接
//! 写同一个工作区库（WAL + busy_timeout），失败只记录日志，下一次保存会重试。

use std::path::Path;
use std::sync::OnceLock;
use std::sync::mpsc::{self, SyncSender, TrySendError};
use std::thread;

use serde_json::Value;

use crate::db;
use crate::domain::document::{document_props, to_markdown};
use crate::errors::AppResult;
use crate::logging;
use crate::repositories::document_repository;

/// 元数据写入队列的容量。派生数据允许丢弃：`upsert_meta` 有 update_time 单调守卫，
/// 下一次保存会补写，加载文档时也会惰性回填。
const WRITE_QUEUE_CAPACITY: usize = 64;

/// 一次待写入任务。
struct MetaJob {
    db_path: std::path::PathBuf,
    payload: DocMetaPayload,
}

/// 全局唯一的元数据写入队列；进程内只建一条工作线程。
static WRITE_QUEUE: OnceLock<Option<SyncSender<MetaJob>>> = OnceLock::new();

/// 属性 JSON 的来源。
///
/// 保存路径把规范化正文交给工作线程再算属性，保存线程不再为整篇文档多遍历一遍；
/// 加载期回填仍由调用方算好传入。
#[derive(Debug, Clone)]
enum MetaProps {
    /// 调用方已经算好的属性 JSON。
    Ready(String),
    /// 需要后台线程从规范化正文解析生成。
    Deferred(String),
}

impl MetaProps {
    /// 取出属性 JSON；Deferred 会解析一次正文。
    fn resolve(&self) -> String {
        match self {
            Self::Ready(prop) => prop.clone(),
            Self::Deferred(content) => match serde_json::from_str::<Value>(content) {
                Ok(document) => document_props(&document).to_string(),
                Err(error) => {
                    logging::error("document.meta", &format!("正文解析失败，属性置空: {error}"));
                    "{}".to_string()
                }
            },
        }
    }
}

/// 一次元数据写入载荷；构造后不可变，可安全移入后台线程。
#[derive(Debug, Clone)]
pub struct DocMetaPayload {
    pub node_id: String,
    pub markdown: String,
    props: MetaProps,
    /// 派生数据对应的正文时间；晚到的旧任务不会覆盖新结果。
    pub update_time: i64,
}

impl DocMetaPayload {
    /// 从规范化文档生成载荷（加载期回填用，属性立即算好）。
    pub fn from_document(node_id: &str, document: &Value, update_time: i64) -> Self {
        Self {
            node_id: node_id.to_string(),
            markdown: to_markdown(document),
            props: MetaProps::Ready(document_props(document).to_string()),
            update_time,
        }
    }

    /// 保存路径：Markdown 已生成，属性交给工作线程从正文生成。
    pub fn for_save(node_id: &str, markdown: String, content: String, update_time: i64) -> Self {
        Self {
            node_id: node_id.to_string(),
            markdown,
            props: MetaProps::Deferred(content),
            update_time,
        }
    }

    /// 属性 JSON；Deferred 载荷会在这里解析一次正文。
    pub fn prop_json(&self) -> String {
        self.props.resolve()
    }
}

/// 取（必要时创建）全局写入队列。
///
/// 以前每次保存都新建一条 OS 线程：连续打字每秒一次保存就等于每秒一条线程，
/// 线程只增不减，长跑会堆积。现在固定一条工作线程，队列满时丢弃派生写入。
fn write_queue() -> &'static Option<SyncSender<MetaJob>> {
    WRITE_QUEUE.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel::<MetaJob>(WRITE_QUEUE_CAPACITY);
        let spawned = thread::Builder::new()
            .name("starris-doc-meta".to_string())
            .spawn(move || {
                while let Ok(job) = receiver.recv() {
                    if let Err(error) = write_now(&job.db_path, &job.payload) {
                        logging::error(
                            "document.meta",
                            &format!(
                                "异步写入文档元数据失败 node={}: {error}",
                                job.payload.node_id
                            ),
                        );
                    }
                }
            });
        match spawned {
            Ok(_) => Some(sender),
            Err(error) => {
                logging::error("document.meta", &format!("启动元数据线程失败: {error}"));
                None
            }
        }
    })
}

/// 投递一次异步写入；线程创建失败或队列积压只记日志，不影响正文保存。
pub fn schedule_write(db_path: std::path::PathBuf, payload: DocMetaPayload) {
    let Some(sender) = write_queue().as_ref() else {
        return;
    };
    match sender.try_send(MetaJob { db_path, payload }) {
        Ok(()) => {}
        Err(TrySendError::Full(job)) => {
            logging::debug(
                "document.meta",
                &format!(
                    "元数据队列已满，丢弃本次派生写入 node={}",
                    job.payload.node_id
                ),
            );
        }
        Err(TrySendError::Disconnected(job)) => {
            logging::error(
                "document.meta",
                &format!("元数据线程已退出，丢弃写入 node={}", job.payload.node_id),
            );
        }
    }
}

/// 同步写入（后台线程与测试共用）；数据库文件不存在时直接放弃。
pub fn write_now(db_path: &Path, payload: &DocMetaPayload) -> AppResult<()> {
    let connection = db::workspace::open_existing(db_path)?;
    let prop = payload.prop_json();
    document_repository::upsert_meta(
        &connection,
        &payload.node_id,
        &payload.markdown,
        &prop,
        payload.update_time,
    )?;
    logging::debug(
        "document.meta",
        &format!(
            "文档元数据已写入 node={} markdown={}B prop={}B",
            payload.node_id,
            payload.markdown.len(),
            prop.len()
        ),
    );
    Ok(())
}

/// 元数据缺失或与当前正文不一致时补写；加载旧文档时惰性补齐。
///
/// 先看时间戳：派生数据的时间不早于正文就说明已经同步过，直接返回——
/// 否则每次打开文档都要把整份正文重新序列化成 markdown + props（O(文档)）再发现"其实没变"。
/// 时间戳落后时再逐字比对，完全相同则不重复写，避免每次切标签都产生后台 IO。
pub fn backfill_if_missing(
    connection: &rusqlite::Connection,
    db_path: &Path,
    node_id: &str,
    document: &Value,
    update_time: i64,
) -> AppResult<()> {
    let existing = document_repository::find_meta(connection, node_id)?;
    if let Some((_, _, meta_update_time)) = existing.as_ref()
        && *meta_update_time >= update_time
    {
        return Ok(());
    }
    let payload = DocMetaPayload::from_document(node_id, document, update_time);
    if let Some((markdown, prop, _)) = existing
        && markdown == payload.markdown
        && prop == payload.prop_json()
    {
        return Ok(());
    }
    schedule_write(db_path.to_path_buf(), payload);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deferred_payload_matches_eager_props() {
        let document = json!({"type":"doc","content":[
            {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"标题"}]},
            {"type":"paragraph","content":[{"type":"text","text":"正文"}]}
        ]});
        let content = serde_json::to_string(&document).expect("序列化正文");
        let eager = DocMetaPayload::from_document("node-1", &document, 1);
        let deferred = DocMetaPayload::for_save("node-1", eager.markdown.clone(), content, 1);
        assert_eq!(deferred.markdown, eager.markdown, "Markdown 必须一致");
        assert_eq!(
            deferred.prop_json(),
            eager.prop_json(),
            "延迟计算的属性必须与即时计算一致"
        );
    }
}
