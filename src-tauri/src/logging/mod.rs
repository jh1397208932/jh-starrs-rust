//! 全局工作区日志：固定写入 `logs/starris.log`，单文件滚动，启动时清空上一轮。
//!
//! 规范见 AGENTS.md §10：信息只写事实与状态切换；不写文档正文、令牌或完整用户数据。
//! 日志初始化失败不阻断应用启动，但会丢失落盘能力（错误仍由前端 toast 呈现）。

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::Local;

/// 日志目录在进程内只解析一次。
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
/// 串行写入，避免并发追加时行交错。
static WRITE_LOCK: Mutex<()> = Mutex::new(());

const LOG_FILE_NAME: &str = "starris.log";
/// 单行最大字符数，超出截断，保证“一行一件事”便于 grep。
const MAX_LINE_CHARS: usize = 8192;
/// 默认单文件上限 10 MiB；可用 STARRIS_LOG_MAX_MB 覆盖。
const DEFAULT_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// 初始化日志目录：创建目录、清理上一轮日志、写入启动标记。
///
/// @param log_dir 全局工作区的 `logs/` 目录
/// @returns 目录创建或写入失败时返回 IO 错误（调用方仅记录，不阻断启动）
pub fn init(log_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(log_dir)?;
    clear_previous_logs(log_dir);
    let _ = LOG_DIR.set(log_dir.to_path_buf());
    write_line("info", "app", "应用启动，日志已重置为本轮");
    Ok(())
}

/// 记录长期保留的信息级日志。
pub fn info(target: &str, message: &str) {
    write_line("info", target, message);
}

/// 记录异常分支；详细原因保留在日志，不返回给前端。
pub fn error(target: &str, message: &str) {
    write_line("error", target, message);
}

/// 记录排查细节；仅当 STARRIS_LOG_LEVEL=debug 时落盘。
pub fn debug(target: &str, message: &str) {
    if std::env::var("STARRIS_LOG_LEVEL").is_ok_and(|level| level.eq_ignore_ascii_case("debug")) {
        write_line("debug", target, message);
    }
}

/// 只清理自己命名的文件，目录里其他文件原样保留。
fn clear_previous_logs(log_dir: &Path) {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == LOG_FILE_NAME || name.starts_with(&format!("{LOG_FILE_NAME}.")) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// 将一行文本追加到日志；时间戳使用本地时区，含毫秒。
fn write_line(level: &str, target: &str, message: &str) {
    let Some(log_dir) = LOG_DIR.get() else {
        return;
    };
    let timestamp = Local::now().format("%Y-%m-%dT%H:%M:%S%.3f%:z");
    let safe_message = sanitize(message);
    let Ok(_guard) = WRITE_LOCK.lock() else {
        return;
    };
    rotate_if_needed(log_dir);
    let path = log_dir.join(LOG_FILE_NAME);
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut file) => {
            let _ = writeln!(file, "{timestamp} {level} [{target}] {safe_message}");
        }
        Err(error) => {
            // 日志失败不向业务层抛错，避免“记录日志”反过来打断主流程。
            eprintln!("starris log write failed: {error}");
        }
    }
}

/// 折叠换行并截断过长单行；按字符截断，避免切断 UTF-8 字节序列。
fn sanitize(message: &str) -> String {
    let folded = message.replace(['\n', '\r'], "\\n");
    folded.chars().take(MAX_LINE_CHARS).collect()
}

/// 超过上限时滚动为 `starris.log.1`（只保留一个历史文件）。
fn rotate_if_needed(log_dir: &Path) {
    let path = log_dir.join(LOG_FILE_NAME);
    let max_bytes = std::env::var("STARRIS_LOG_MAX_MB")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(|mb| mb.saturating_mul(1024 * 1024))
        .unwrap_or(DEFAULT_MAX_BYTES);
    let Ok(metadata) = fs::metadata(&path) else {
        return;
    };
    if metadata.len() < max_bytes {
        return;
    }
    let rotated = log_dir.join(format!("{LOG_FILE_NAME}.1"));
    let _ = fs::remove_file(&rotated);
    let _ = fs::rename(&path, rotated);
}
