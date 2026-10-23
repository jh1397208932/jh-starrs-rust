//! 附件校验、逻辑路径与物理布局规则。
//!
//! 这里是名称/路径/MIME 的唯一权威校验点；仓储与存储引擎都不得绕过。

use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

/// 小对象阈值：严格小于该值的文件进入 pack，否则进入 big。
pub const SMALL_OBJECT_THRESHOLD: u64 = 128 * 1024;
/// 单个 active pack 的滚动上限。
pub const PACK_ROLL_BYTES: u64 = 1024 * 1024 * 1024;
/// 死字节占比达到该值时考虑 compaction。
pub const COMPACTION_DEAD_RATIO: f64 = 0.30;
/// 死字节低于该值时不做 compaction，避免小包频繁重写。
pub const COMPACTION_MIN_DEAD_BYTES: u64 = 4 * 1024 * 1024;
/// 固定流式缓冲区。
pub const STREAM_BUFFER_BYTES: usize = 256 * 1024;

/// 可注入的存储策略；默认值用于生产，测试可缩小阈值。
#[derive(Debug, Clone, Copy)]
pub struct StoragePolicy {
    pub small_object_threshold: u64,
    pub pack_roll_bytes: u64,
    pub compaction_dead_ratio: f64,
    pub compaction_min_dead_bytes: u64,
}

impl Default for StoragePolicy {
    fn default() -> Self {
        Self {
            small_object_threshold: SMALL_OBJECT_THRESHOLD,
            pack_roll_bytes: PACK_ROLL_BYTES,
            compaction_dead_ratio: COMPACTION_DEAD_RATIO,
            compaction_min_dead_bytes: COMPACTION_MIN_DEAD_BYTES,
        }
    }
}

impl StoragePolicy {
    /// 是否应对 pack 做 compaction。
    pub fn should_compact(&self, pack_size: u64, live_bytes: u64) -> bool {
        if pack_size == 0 || live_bytes > pack_size {
            return false;
        }
        let dead_bytes = pack_size - live_bytes;
        if dead_bytes < self.compaction_min_dead_bytes {
            return false;
        }
        dead_bytes as f64 / pack_size as f64 >= self.compaction_dead_ratio
    }

    /// 该大小是否进入 small pack。
    pub fn is_small(&self, size: u64) -> bool {
        size < self.small_object_threshold
    }
}

/// 校验 64 位小写十六进制 BLAKE3 哈希。
pub fn validate_hash(hash: &str) -> AppResult<()> {
    if hash.len() != 64 {
        return Err(AppError::validation("附件哈希格式无效"));
    }
    if !hash
        .bytes()
        .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err(AppError::validation("附件哈希格式无效"));
    }
    Ok(())
}

/// 规范化逻辑目录：相对路径、`/` 分隔、空串为根。
///
/// 接受 `a\b` 并转为 `a/b`；折叠重复分隔符；拒绝绝对路径、`.`/`..`、
/// 控制字符、超长组件或超长总路径。
pub fn normalize_logical_path(raw: &str) -> AppResult<String> {
    let replaced = raw.replace('\\', "/");
    let trimmed = replaced.trim();
    if trimmed.is_empty() || trimmed.chars().all(|character| character == '/') {
        return Ok(String::new());
    }
    if trimmed.starts_with('/') {
        return Err(AppError::validation("逻辑目录必须是相对路径"));
    }
    if trimmed.len() > 1024 {
        return Err(AppError::validation("逻辑目录过长（最多 1024 字符）"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation("逻辑目录不能包含控制字符"));
    }
    let mut components = Vec::new();
    for component in trimmed.split('/') {
        if component.is_empty() {
            continue;
        }
        if component == "." || component == ".." {
            return Err(AppError::validation("逻辑目录不能包含 . 或 .."));
        }
        if component.len() > 255 {
            return Err(AppError::validation("逻辑目录的单个层级过长"));
        }
        components.push(component);
    }
    Ok(components.join("/"))
}

/// 校验用户可见文件名：不能包含路径分隔符、控制字符，不能是 `.`/`..`。
pub fn validate_file_name(raw: &str) -> AppResult<String> {
    if raw.trim() != raw {
        return Err(AppError::validation("文件名不能以空白开头或结尾"));
    }
    if raw.is_empty() {
        return Err(AppError::validation("文件名不能为空"));
    }
    if raw == "." || raw == ".." {
        return Err(AppError::validation("文件名无效"));
    }
    if raw.contains('/') || raw.contains('\\') {
        return Err(AppError::validation("文件名不能包含路径分隔符"));
    }
    if raw.chars().any(char::is_control) {
        return Err(AppError::validation("文件名不能包含控制字符"));
    }
    if raw.len() > 255 {
        return Err(AppError::validation("文件名过长（最多 255 字节）"));
    }
    Ok(raw.to_string())
}

/// 选择 MIME：调用方提供的合法值优先，否则按扩展名推断。
pub fn resolve_mime(provided: Option<&str>, file_name: &str) -> AppResult<String> {
    if let Some(value) = provided {
        let value = value.trim();
        if !value.is_empty() {
            if value.len() > 255 || value.chars().any(char::is_control) {
                return Err(AppError::validation("MIME 类型无效"));
            }
            return Ok(value.to_string());
        }
    }
    Ok(mime_guess::from_path(file_name)
        .first_or_octet_stream()
        .essence_str()
        .to_string())
}

/// 校验临时生成的 pack id：只允许 UUID/ASCII 安全字符。
pub fn validate_pack_id(pack_id: &str) -> AppResult<()> {
    if pack_id.is_empty()
        || pack_id.len() > 64
        || !pack_id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
    {
        return Err(AppError::Internal);
    }
    Ok(())
}

/// big 对象相对工作区根的路径：`objects/big/hh/hh/<hash>`。
pub fn big_relative_path(hash: &str) -> AppResult<PathBuf> {
    validate_hash(hash)?;
    Ok(PathBuf::from("objects")
        .join("big")
        .join(&hash[0..2])
        .join(&hash[2..4])
        .join(hash))
}

/// pack 数据相对工作区根的路径：`objects/small/packs/<pack-id>.pack`。
pub fn pack_relative_path(pack_id: &str) -> AppResult<PathBuf> {
    validate_pack_id(pack_id)?;
    Ok(PathBuf::from("objects")
        .join("small")
        .join("packs")
        .join(format!("{pack_id}.pack")))
}

/// 临时文件目录相对路径。
pub const TEMP_DIR_RELATIVE: &str = "tmp";

/// 创建工作区 storage 的固定目录。
pub fn ensure_storage_layout(root: &Path) -> AppResult<()> {
    std::fs::create_dir_all(root.join("objects").join("big"))?;
    std::fs::create_dir_all(root.join("objects").join("small").join("packs"))?;
    std::fs::create_dir_all(root.join(TEMP_DIR_RELATIVE))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_logical_paths() {
        assert_eq!(normalize_logical_path("").unwrap(), "");
        assert_eq!(normalize_logical_path("  /  ").unwrap(), "");
        assert_eq!(normalize_logical_path("a/b").unwrap(), "a/b");
        assert_eq!(normalize_logical_path(r"a\b\\c").unwrap(), "a/b/c");
        assert!(normalize_logical_path("../a").is_err());
        assert!(normalize_logical_path("/a").is_err());
        assert!(normalize_logical_path("a/./b").is_err());
        assert!(normalize_logical_path("a/\u{0000}").is_err());
    }

    #[test]
    fn validates_names_and_mime() {
        assert_eq!(
            validate_file_name("设计稿 01.png").unwrap(),
            "设计稿 01.png"
        );
        assert!(validate_file_name("").is_err());
        assert!(validate_file_name(".").is_err());
        assert!(validate_file_name("a/b").is_err());
        assert!(validate_file_name(" a").is_err());
        assert_eq!(resolve_mime(None, "a.png").unwrap(), "image/png");
        assert_eq!(
            resolve_mime(Some("application/pdf"), "a.bin").unwrap(),
            "application/pdf"
        );
        assert_eq!(
            resolve_mime(None, "a.unknown-ext").unwrap(),
            "application/octet-stream"
        );
    }

    #[test]
    fn builds_hashed_paths_and_checks_policy() {
        let hash = "ab".repeat(32);
        assert_eq!(
            big_relative_path(&hash).unwrap(),
            PathBuf::from(format!("objects/big/ab/ab/{hash}"))
        );
        assert!(big_relative_path("abc").is_err());

        let pack_id = "0199a0b1-1234-7abc-8def-0123456789ab";
        assert_eq!(
            pack_relative_path(pack_id).unwrap(),
            PathBuf::from(format!("objects/small/packs/{pack_id}.pack"))
        );
        assert!(pack_relative_path("../x").is_err());

        let policy = StoragePolicy {
            small_object_threshold: 100,
            pack_roll_bytes: 1000,
            compaction_dead_ratio: 0.5,
            compaction_min_dead_bytes: 10,
        };
        assert!(policy.is_small(99));
        assert!(!policy.is_small(100));
        assert!(!policy.should_compact(1000, 600));
        assert!(policy.should_compact(1000, 400));
        assert!(!policy.should_compact(100, 90));
    }
}
