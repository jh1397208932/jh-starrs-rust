//! 导出路径授权：由 Rust 打开系统保存/目录面板，签发短期一次性令牌。
//!
//! 前端不再能把任意路径传给导出命令；令牌与用户实际选择的路径绑定，
//! 单文件令牌一次即焚，目录令牌只允许写入该目录及其后代。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::errors::{AppError, AppResult};
use crate::models::exchange::ExportPathGrantDto;
use crate::utils::{new_id, now_ms};

/// 令牌有效期：10 分钟，足够用户先选路径再完成一次导出。
const GRANT_TTL_MS: i64 = 10 * 60 * 1000;

struct PathGrant {
    path: PathBuf,
    directory: bool,
    expires_at: i64,
}

static GRANTS: LazyLock<Mutex<HashMap<String, PathGrant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_grants() -> AppResult<std::sync::MutexGuard<'static, HashMap<String, PathGrant>>> {
    GRANTS.lock().map_err(|_| AppError::Internal)
}

fn issue(path: PathBuf, directory: bool) -> AppResult<ExportPathGrantDto> {
    let token = new_id();
    let display = path.to_string_lossy().into_owned();
    let mut grants = lock_grants()?;
    let now = now_ms();
    grants.retain(|_, grant| grant.expires_at > now);
    grants.insert(
        token.clone(),
        PathGrant {
            path,
            directory,
            expires_at: now + GRANT_TTL_MS,
        },
    );
    Ok(ExportPathGrantDto {
        token,
        path: display,
    })
}

/// 消费单文件令牌；返回用户实际选择的路径。
pub fn resolve_file(token: &str) -> AppResult<PathBuf> {
    let grant = {
        let mut grants = lock_grants()?;
        grants.remove(token)
    }
    .ok_or_else(|| AppError::validation("导出位置已失效，请重新选择"))?;
    if grant.directory || grant.expires_at <= now_ms() {
        return Err(AppError::validation("导出位置已失效，请重新选择"));
    }
    Ok(grant.path)
}

/// 校验目录令牌；令牌在有效期内可复用于该目录下的批量写入。
pub fn resolve_directory(token: &str) -> AppResult<PathBuf> {
    let mut grants = lock_grants()?;
    let grant = grants
        .get(token)
        .ok_or_else(|| AppError::validation("导出位置已失效，请重新选择"))?;
    if !grant.directory || grant.expires_at <= now_ms() {
        grants.remove(token);
        return Err(AppError::validation("导出位置已失效，请重新选择"));
    }
    Ok(grant.path.clone())
}

/// 校验一次写入：文件令牌必须与目标一致；目录令牌允许写入后代并保留到过期。
pub fn resolve_write(token: &str, requested: &str) -> AppResult<PathBuf> {
    let requested_path = Path::new(requested);
    if !requested_path.is_absolute() {
        return Err(AppError::validation("导出路径必须是绝对路径"));
    }
    // `Path::starts_with` 把 `..` 当普通组件：`/granted/../evil` 也会通过前缀检查。
    // 导出目标由系统面板产生，合法路径不含 `..`，出现即拒绝。
    if requested_path
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(AppError::validation("导出路径不能包含 .. 上级目录"));
    }
    let mut grants = lock_grants()?;
    let grant = grants
        .get(token)
        .ok_or_else(|| AppError::validation("导出位置已失效，请重新选择"))?;
    if grant.expires_at <= now_ms() {
        grants.remove(token);
        return Err(AppError::validation("导出位置已失效，请重新选择"));
    }
    if grant.directory {
        if !requested_path.starts_with(&grant.path) {
            return Err(AppError::validation("导出路径超出所选文件夹"));
        }
        return Ok(requested_path.to_path_buf());
    }
    if requested_path != grant.path {
        return Err(AppError::validation("导出路径与所选位置不一致"));
    }
    let grant = grants
        .remove(token)
        .ok_or_else(|| AppError::validation("导出位置已失效，请重新选择"))?;
    Ok(grant.path)
}

/// 打开系统保存面板并签发单文件令牌。
#[tauri::command(async)]
pub async fn dialog_pick_export_file(
    app: AppHandle,
    suggested_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> AppResult<Option<ExportPathGrantDto>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .set_title("导出")
            .set_file_name(suggested_name);
        if !extensions.is_empty() {
            let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
            builder = builder.add_filter(filter_name, &refs);
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(|_| AppError::Internal)?;
    let Some(file) = picked else {
        return Ok(None);
    };
    let path = file
        .into_path()
        .map_err(|_| AppError::validation("所选导出位置不可用"))?;
    Ok(Some(issue(path, false)?))
}

/// 打开系统目录面板并签发目录令牌。
#[tauri::command(async)]
pub async fn dialog_pick_export_dir(
    app: AppHandle,
    title: String,
) -> AppResult<Option<ExportPathGrantDto>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).blocking_pick_folder()
    })
    .await
    .map_err(|_| AppError::Internal)?;
    let Some(folder) = picked else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| AppError::validation("所选导出位置不可用"))?;
    Ok(Some(issue(path, true)?))
}

#[cfg(test)]
mod tests {
    use super::{issue, resolve_directory, resolve_file, resolve_write};
    use crate::errors::AppError;

    #[test]
    fn file_grant_is_single_use_and_bound_to_selected_path() {
        let grant = issue(std::path::PathBuf::from("/tmp/starris-export.md"), false).expect("签发");
        let wrong = resolve_write(&grant.token, "/tmp/other.md").expect_err("路径不一致必须拒绝");
        assert!(matches!(wrong, AppError::Validation(_)));
        let used = resolve_file(&grant.token).expect("首次消费");
        assert_eq!(used, std::path::PathBuf::from("/tmp/starris-export.md"));
        assert!(resolve_file(&grant.token).is_err(), "令牌必须一次即焚");
    }

    #[test]
    fn directory_grant_allows_descendants_but_not_siblings() {
        let root = std::path::PathBuf::from("/tmp/starris-export");
        let grant = issue(root.clone(), true).expect("签发");
        let child = resolve_write(&grant.token, "/tmp/starris-export/kb/a.png").expect("后代可写");
        assert_eq!(
            child,
            std::path::PathBuf::from("/tmp/starris-export/kb/a.png")
        );
        let outside = resolve_write(&grant.token, "/tmp/other/a.png").expect_err("越界必须拒绝");
        assert!(matches!(outside, AppError::Validation(_)));
        assert_eq!(resolve_directory(&grant.token).expect("目录校验"), root);
    }

    #[test]
    fn directory_grant_rejects_parent_dir_escape() {
        let grant = issue(std::path::PathBuf::from("/tmp/starris-export"), true).expect("签发");
        let escaped = resolve_write(&grant.token, "/tmp/starris-export/../evil.txt")
            .expect_err("`..` 前缀绕过必须拒绝");
        assert!(matches!(escaped, AppError::Validation(_)));
    }
}
