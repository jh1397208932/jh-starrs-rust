//! 应用共享状态：一个全局库连接 + 至多一个当前工作区连接。
//!
//! 约定：同一函数内不允许同时持有两把锁；切换工作区时先完成 IO，再分别短暂加锁，
//! 避免“一条语句取两次锁”导致静默死锁（见项目记忆）。

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

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
    /// 打开工作区库并迁移；目录缺少数据库时返回无效工作区错误。
    pub fn open(record: &WorkspaceRecord) -> AppResult<Self> {
        let root = PathBuf::from(&record.path);
        if !db::paths::is_valid_workspace(&root) {
            return Err(AppError::InvalidWorkspace);
        }
        let db_path = db::paths::workspace_db_path(&root);
        let connection = db::workspace::open(&db_path)?;
        Ok(Self {
            workspace_id: record.id.clone(),
            root_path: root,
            db_path,
            connection,
        })
    }
}

/// Tauri 托管的应用状态。
pub struct AppState {
    /// 全局库连接；只在工作区管理与记忆配置时短暂加锁。
    pub global: Mutex<Connection>,
    /// 当前工作区连接；None 表示首次引导阶段或最后一个工作区已删除。
    pub workspace: Mutex<Option<WorkspaceSession>>,
}

impl AppState {
    /// 组装应用状态。
    pub fn new(global: Connection, workspace: Option<WorkspaceSession>) -> Self {
        Self {
            global: Mutex::new(global),
            workspace: Mutex::new(workspace),
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
}

#[test]
fn assert_state_is_send_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<AppState>();
}
