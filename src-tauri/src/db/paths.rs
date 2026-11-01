//! 路径与目录布局：全局工作区固定目录、工作区固定相对路径、删除前安全校验。

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

/// 工作区数据库相对路径：`db/workspace.sqlite3`。
pub const WORKSPACE_DB_RELATIVE: &str = "db/workspace.sqlite3";
/// 工作区附件目录相对路径：`storage`。
pub const WORKSPACE_STORAGE_RELATIVE: &str = "storage";

/// 全局工作区目录布局。
#[derive(Debug, Clone)]
pub struct GlobalPaths {
    pub logs_dir: PathBuf,
    pub global_db: PathBuf,
}

impl GlobalPaths {
    /// 解析全局工作区目录并确保目录存在。
    ///
    /// 默认 `~/.starris/rust`；`STARRIS_HOME` 可覆盖（测试与多版本隔离），
    /// 相对路径会以当前工作目录为基准转成绝对路径。
    pub fn resolve() -> AppResult<Self> {
        let root = match env::var_os("STARRIS_HOME") {
            Some(value) => PathBuf::from(value),
            None => home_dir()?.join(".starris").join("rust"),
        };
        let root = if root.is_absolute() {
            root
        } else {
            env::current_dir()?.join(root)
        };
        let logs_dir = root.join("logs");
        let db_dir = root.join("db");
        fs::create_dir_all(&logs_dir)?;
        fs::create_dir_all(&db_dir)?;
        Ok(Self {
            global_db: db_dir.join("starris.db"),
            logs_dir,
        })
    }
}

/// 当前用户主目录；找不到时以当前目录兜底，避免启动直接失败。
pub fn home_dir() -> AppResult<PathBuf> {
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        return Ok(PathBuf::from(home));
    }
    Ok(env::current_dir()?)
}

/// 默认新建工作区的父目录：`~/Starris`（不自动创建，创建时按需建）。
pub fn default_workspace_parent() -> AppResult<PathBuf> {
    Ok(home_dir()?.join("Starris"))
}

/// 工作区数据库绝对路径。
pub fn workspace_db_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_DB_RELATIVE)
}

/// 工作区附件目录绝对路径。
pub fn workspace_storage_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_STORAGE_RELATIVE)
}

/// 目录是否具备有效工作区结构（数据库文件存在且为普通文件）。
pub fn is_valid_workspace(root: &Path) -> bool {
    workspace_db_path(root)
        .metadata()
        .is_ok_and(|metadata| metadata.is_file())
}

/// 创建工作区的固定子目录（不创建数据库文件）。
pub fn ensure_workspace_layout(root: &Path) -> AppResult<()> {
    fs::create_dir_all(root.join("db"))?;
    fs::create_dir_all(workspace_storage_path(root))?;
    Ok(())
}

/// 将用户提供的目录路径规范化：必须绝对、存在且是目录。
pub fn canonicalize_existing_dir(path: &str) -> AppResult<PathBuf> {
    let input = PathBuf::from(path);
    if !input.is_absolute() {
        return Err(AppError::validation("工作区路径必须是绝对路径"));
    }
    let metadata = fs::metadata(&input).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::validation("所选文件夹不存在")
        } else {
            AppError::FileSystem
        }
    })?;
    if !metadata.is_dir() {
        return Err(AppError::validation("所选路径不是文件夹"));
    }
    Ok(input.canonicalize()?)
}

/// 打开已有工作区前校验目录结构。
pub fn canonicalize_existing_workspace(path: &str) -> AppResult<PathBuf> {
    let root = canonicalize_existing_dir(path)?;
    if !is_valid_workspace(&root) {
        return Err(AppError::InvalidWorkspace);
    }
    Ok(root)
}

/// 删除目录前做安全校验，返回可删除的规范化路径。
///
/// 拒绝：符号链接、文件系统根、用户主目录、全局工作区目录、缺少工作区数据库的目录。
pub fn verify_workspace_deletable(root: &Path) -> AppResult<PathBuf> {
    let symlink_metadata = fs::symlink_metadata(root)?;
    if symlink_metadata.file_type().is_symlink() {
        return Err(AppError::validation(
            "工作区目录是符号链接，为安全起见不删除",
        ));
    }
    if !symlink_metadata.is_dir() {
        return Err(AppError::validation("工作区路径不是文件夹"));
    }
    let canonical = root.canonicalize()?;
    if canonical.parent().is_none() {
        return Err(AppError::validation("拒绝删除文件系统根目录"));
    }
    if canonical == home_dir()?.canonicalize()? {
        return Err(AppError::validation("拒绝删除用户主目录"));
    }
    if !is_valid_workspace(&canonical) {
        return Err(AppError::InvalidWorkspace);
    }
    Ok(canonical)
}

/// 把路径转为 UTF-8 字符串返回给前端。
///
/// Windows 的 `canonicalize` 会返回 verbatim 前缀（`\\?\C:\...`），
/// 直接展示或持久化会让用户看到怪异前缀，也会让部分外部工具无法识别；
/// 这里在输出前还原为普通路径。Unicode 长路径仍然可用，Rust 内部
/// 会按需重新规范化。
pub fn path_to_string(path: &Path) -> AppResult<String> {
    let text = path
        .to_str()
        .ok_or_else(|| AppError::validation("路径包含无法识别的字符"))?;
    Ok(strip_verbatim_prefix(text))
}

/// 去掉 Windows verbatim 前缀；UNC 路径还原为 `\\server\share`。
fn strip_verbatim_prefix(text: &str) -> String {
    #[cfg(windows)]
    {
        // 普通字符串：`"\\\\?\\"` 即字面量 `\\?\`。
        if let Some(rest) = text.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{rest}");
        }
        if let Some(rest) = text.strip_prefix("\\\\?\\") {
            return rest.to_string();
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows 的 canonicalize 会带 `\\?\` 前缀；输出给前端前必须还原。
    #[test]
    fn path_to_string_strips_verbatim_prefix() {
        let raw = "\\\\?\\C:\\Users\\me\\Starris";
        let output = path_to_string(Path::new(raw)).expect("路径应可转为字符串");
        #[cfg(windows)]
        assert_eq!(output, "C:\\Users\\me\\Starris");
        #[cfg(not(windows))]
        assert_eq!(output, raw);
    }

    /// UNC 共享路径不能被还原成单反斜杠。
    #[cfg(windows)]
    #[test]
    fn path_to_string_restores_unc_prefix() {
        let raw = "\\\\?\\UNC\\server\\share\\Starris";
        let output = path_to_string(Path::new(raw)).expect("路径应可转为字符串");
        assert_eq!(output, "\\\\server\\share\\Starris");
    }
}
