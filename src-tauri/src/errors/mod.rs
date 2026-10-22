//! 统一错误类型：对前端只暴露可读、无敏感路径的信息；详细错误写入全局日志。

use serde::ser::{Serialize, Serializer};
use std::io;

use crate::logging;

/// 应用统一错误。命令层返回 `AppError`，由 Tauri 序列化为字符串给前端 toast。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// 用户可修正的输入错误（名称、路径、层级规则等）
    #[error("{0}")]
    Validation(String),
    /// 目标记录不存在
    #[error("{0}")]
    NotFound(String),
    /// 与现有数据冲突（重复路径、非空目录等）
    #[error("{0}")]
    Conflict(String),
    /// 当前没有已连接的工作区
    #[error("还没有打开工作区，请先新建或打开一个本地工作区")]
    NoActiveWorkspace,
    /// 目录缺少工作区结构或数据库无法使用
    #[error("所选文件夹不是有效的工作区（缺少 db/workspace.sqlite3 或数据库不可用）")]
    InvalidWorkspace,
    /// 数据库错误（详细原因只写日志）
    #[error("数据库操作失败，请稍后重试")]
    Database,
    /// 文件系统错误（详细原因只写日志）
    #[error("文件系统操作失败，请检查目录权限后重试")]
    FileSystem,
    /// 内部状态异常（锁中毒、迁移版本过新等）
    #[error("应用内部状态异常，请重启应用")]
    Internal,
}

impl AppError {
    /// 构造输入校验错误。
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation(message.into())
    }

    /// 构造“未找到”错误。
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    /// 构造冲突错误。
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::Conflict(message.into())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        logging::error("db", &format!("SQLite 操作失败: {error}"));
        Self::Database
    }
}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        logging::error("fs", &format!("文件系统操作失败: {error}"));
        Self::FileSystem
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 后端统一结果类型。
pub type AppResult<T> = Result<T, AppError>;
