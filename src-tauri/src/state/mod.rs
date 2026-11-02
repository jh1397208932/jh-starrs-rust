//! 应用共享状态：一个全局库连接 + 至多一个当前工作区连接。
//!
//! 约定：同一函数内不允许同时持有两把锁；切换工作区时先完成 IO，再分别短暂加锁，
//! 避免“一条语句取两次锁”导致静默死锁（见项目记忆）。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::db;
use crate::errors::{AppError, AppResult};
use crate::models::WorkspaceRecord;

/// 当前已连接的工作区会话；drop 即释放 SQLite 连接。
pub struct WorkspaceSession {
    pub workspace_id: String,
    /// 工作区根目录；附件 storage/ 与相对路径解析使用。
    pub root_path: PathBuf,
    /// 工作区库文件绝对路径；异步元数据写入使用独立连接打开它。
    pub db_path: PathBuf,
    pub connection: Connection,
}

impl WorkspaceSession {
    /// 打开工作区并保证结构就绪；目录缺少数据库时返回无效工作区错误。
    ///
    /// 初始化只在版本为 0 的空库上建表：版本一致直接放行，其余版本一律拒绝，
    /// 不做迁移或结构自愈（AGENTS.md §9 无历史数据原则）。
    pub fn open(record: &WorkspaceRecord) -> AppResult<Self> {
        let root = PathBuf::from(&record.path);
        if !db::paths::is_valid_workspace(&root) {
            return Err(AppError::InvalidWorkspace);
        }
        let db_path = db::paths::workspace_db_path(&root);
        let mut connection = db::workspace::open_connection(&db_path)?;
        db::workspace::ensure_initialized(&mut connection)?;
        Ok(Self {
            workspace_id: record.id.clone(),
            root_path: root,
            db_path,
            connection,
        })
    }
}

/// 启动初始化进度：前端据此决定何时发起工作区查询。
#[derive(Default)]
pub struct BootstrapGate {
    ready: AtomicBool,
    error: Mutex<Option<String>>,
}

impl BootstrapGate {
    /// 标记启动初始化完成。
    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }

    /// 标记启动初始化失败（前端展示可读错误）。
    pub fn mark_failed(&self, message: impl Into<String>) {
        if let Ok(mut guard) = self.error.lock() {
            *guard = Some(message.into());
        }
        self.ready.store(true, Ordering::SeqCst);
    }

    /// 当前状态：ready 与错误信息（错误存在时 ready 也为 true，便于前端停止等待）。
    pub fn status(&self) -> (bool, Option<String>) {
        let ready = self.ready.load(Ordering::SeqCst);
        let error = self.error.lock().ok().and_then(|guard| guard.clone());
        (ready, error)
    }
}

/// Tauri 托管的应用状态。
pub struct AppState {
    /// 全局库连接；只在工作区管理与记忆配置时短暂加锁。
    pub global: Mutex<Connection>,
    /// 当前工作区连接；None 表示首次引导阶段或最后一个工作区已删除。
    pub workspace: Mutex<Option<WorkspaceSession>>,
    /// 启动初始化进度门。
    pub bootstrap: Arc<BootstrapGate>,
}

impl AppState {
    /// 组装应用状态。
    pub fn new(global: Connection, workspace: Option<WorkspaceSession>) -> Self {
        Self {
            global: Mutex::new(global),
            workspace: Mutex::new(workspace),
            bootstrap: Arc::new(BootstrapGate::default()),
        }
    }

    /// 获取全局库连接守卫。
    pub fn global(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.global.lock().map_err(|_| AppError::Internal)
    }

    /// 获取当前工作区槽位守卫。
    pub fn workspace(&self) -> AppResult<MutexGuard<'_, Option<WorkspaceSession>>> {
        self.workspace.lock().map_err(|_| AppError::Internal)
    }

    /// 当前工作区 id；无连接时返回 None。
    pub fn current_workspace_id(&self) -> AppResult<Option<String>> {
        let guard = self.workspace()?;
        Ok(guard.as_ref().map(|session| session.workspace_id.clone()))
    }

    /// 重新打开当前工作区的数据库连接。
    ///
    /// 磁盘瞬时错误后，SQLite 连接可能长期停在"只报 I/O 错误"的状态（例如 WAL/SHM 被外部
    /// 进程删除或截断）。此时换一条新连接即可恢复；工作区 id、根目录与库路径保持不变。
    /// @returns 无工作区时不做任何事；重开失败时返回数据库错误
    pub fn reopen_workspace(&self) -> AppResult<()> {
        let mut guard = self.workspace()?;
        let Some(session) = guard.as_ref() else {
            return Ok(());
        };
        let workspace_id = session.workspace_id.clone();
        let root_path = session.root_path.clone();
        let db_path = session.db_path.clone();
        let connection = db::workspace::open_connection(&db_path)?;
        *guard = Some(WorkspaceSession {
            workspace_id,
            root_path,
            db_path,
            connection,
        });
        Ok(())
    }
}

#[test]
fn assert_state_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AppState>();
}
