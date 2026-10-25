//! 领域规则：固定枚举、名称/标题校验与文件树路径拼接。
//!
//! 这些规则是持久化前的最终权威校验，命令层前端校验只用于即时反馈。

use crate::errors::{AppError, AppResult};

pub mod attachment;
pub mod attachment_refs;
pub mod block_plan;
pub mod document;
pub mod fractional_index;

/// 文件树节点类型；数据库存储 1~6，禁止在其他层散落裸数字。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i64)]
pub enum NodeType {
    Folder = 1,
    Doc = 2,
    Board = 3,
    Table = 4,
    Flow = 5,
    Attachment = 6,
}

impl NodeType {
    /// 将数据库/IPC 的数字转换为节点类型。
    pub fn from_i64(value: i64) -> AppResult<Self> {
        match value {
            1 => Ok(Self::Folder),
            2 => Ok(Self::Doc),
            3 => Ok(Self::Board),
            4 => Ok(Self::Table),
            5 => Ok(Self::Flow),
            6 => Ok(Self::Attachment),
            _ => Err(AppError::validation("内容类型无效")),
        }
    }

    /// 转为数据库存储的数字。
    pub fn as_i64(self) -> i64 {
        self as i64
    }

    /// 只有文件夹可以作为父节点。
    pub fn is_folder(self) -> bool {
        matches!(self, Self::Folder)
    }
}

/// 现有 UI 支持的空间头像色令牌；避免把任意字符串写入行内样式。
const ALLOWED_AVATAR_COLORS: [&str; 6] = [
    "var(--primary)",
    "var(--destructive)",
    "var(--logo-c)",
    "var(--glow-b)",
    "var(--accent-foreground)",
    "var(--muted-foreground)",
];

/// 校验并规范化工作区名称。
///
/// @param name 用户输入
/// @returns 去除首尾空格后的名称；空/超长/含控制字符时返回校验错误
pub fn validate_workspace_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("工作区名称不能为空"));
    }
    if trimmed.chars().count() > 80 {
        return Err(AppError::validation("工作区名称不能超过 80 个字符"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation("工作区名称不能包含控制字符"));
    }
    Ok(trimmed.to_string())
}

/// 校验并规范化知识库名称。
pub fn validate_kb_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("知识库名称不能为空"));
    }
    if trimmed.chars().count() > 80 {
        return Err(AppError::validation("知识库名称不能超过 80 个字符"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation("知识库名称不能包含控制字符"));
    }
    Ok(trimmed.to_string())
}

/// 校验知识库描述；空描述按“暂无描述”处理由调用方决定，这里只限制长度。
pub fn validate_kb_description(description: &str) -> AppResult<String> {
    let trimmed = description.trim();
    if trimmed.chars().count() > 500 {
        return Err(AppError::validation("知识库描述不能超过 500 个字符"));
    }
    Ok(trimmed.to_string())
}

/// 校验节点标题。
///
/// 标题作为 materialized path 的一段，禁止 `/`、`\` 与控制字符，避免路径歧义。
pub fn validate_node_title(title: &str) -> AppResult<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(AppError::validation("名称不能为空"));
    }
    if trimmed.chars().count() > 200 {
        return Err(AppError::validation("名称不能超过 200 个字符"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(AppError::validation("名称不能包含 / 或 \\"));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(AppError::validation("名称不能包含控制字符"));
    }
    Ok(trimmed.to_string())
}

/// 校验空间头像色是否为已知设计令牌。
pub fn validate_avatar_color(color: &str) -> AppResult<String> {
    if color.is_empty() {
        return Ok(ALLOWED_AVATAR_COLORS[0].to_string());
    }
    if ALLOWED_AVATAR_COLORS.contains(&color) {
        Ok(color.to_string())
    } else {
        Err(AppError::validation("头像颜色无效"))
    }
}

/// 记忆配置键：字母数字与 `._-`，长度 1~80。
pub fn validate_memory_key(key: &str) -> AppResult<()> {
    if key.is_empty() || key.len() > 80 {
        return Err(AppError::validation("配置键长度必须在 1~80 之间"));
    }
    if !key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err(AppError::validation(
            "配置键只能包含字母、数字、点、下划线和短横线",
        ));
    }
    Ok(())
}

/// 允许的主题名，与前端 tokens.css 的 9 套主题保持一致。
pub const THEME_NAMES: [&str; 9] = [
    "mist", "sunset", "azure", "midnight", "amber", "forest", "rose", "violet", "graphite",
];

/// 校验主题名。
pub fn validate_theme_name(value: &str) -> AppResult<()> {
    if THEME_NAMES.contains(&value) {
        Ok(())
    } else {
        Err(AppError::validation("未知的主题名称"))
    }
}

/// 校验明暗模式。
pub fn validate_theme_mode(value: &str) -> AppResult<()> {
    if matches!(value, "light" | "dark") {
        Ok(())
    } else {
        Err(AppError::validation("明暗模式必须是 light 或 dark"))
    }
}

/// 记忆配置值：纯文本，最多 4096 字节。
pub fn validate_memory_value(value: &str) -> AppResult<()> {
    if value.len() > 4096 {
        return Err(AppError::validation("配置值不能超过 4096 字节"));
    }
    if value.contains('\0') {
        return Err(AppError::validation("配置值不能包含空字符"));
    }
    Ok(())
}

/// 计算节点路径：根节点为标题，子节点为“父路径/标题”。
pub fn join_node_path(parent_path: Option<&str>, title: &str) -> String {
    match parent_path {
        Some(parent) if !parent.is_empty() => format!("{parent}/{title}"),
        _ => title.to_string(),
    }
}

/// 把子树旧前缀替换为新前缀；仅替换真正的路径段前缀。
pub fn replace_path_prefix(path: &str, old_prefix: &str, new_prefix: &str) -> String {
    if path == old_prefix {
        return new_prefix.to_string();
    }
    match path
        .strip_prefix(old_prefix)
        .and_then(|rest| rest.strip_prefix('/'))
    {
        Some(rest) => format!("{new_prefix}/{rest}"),
        None => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_type_rejects_out_of_range() {
        assert!(NodeType::from_i64(1).is_ok());
        assert!(NodeType::from_i64(5).is_ok());
        assert!(NodeType::from_i64(6).is_ok());
        assert!(NodeType::from_i64(0).is_err());
        assert!(NodeType::from_i64(7).is_err());
    }

    #[test]
    fn title_rejects_path_separators() {
        assert!(validate_node_title("a/b").is_err());
        assert!(validate_node_title("a\\b").is_err());
        assert_eq!(validate_node_title("  文档  ").unwrap(), "文档");
    }

    #[test]
    fn replace_prefix_only_matches_segments() {
        assert_eq!(replace_path_prefix("a/b/c", "a/b", "x"), "x/c");
        assert_eq!(replace_path_prefix("a/bc", "a/b", "x"), "a/bc");
        assert_eq!(replace_path_prefix("a/b", "a/b", "x"), "x");
    }

    #[test]
    fn theme_names_accept_all_presets_and_reject_unknown() {
        for name in THEME_NAMES {
            assert!(
                validate_theme_name(name).is_ok(),
                "预设主题 {name} 应被接受"
            );
        }
        assert!(validate_theme_name("mist").is_ok());
        assert!(validate_theme_name("neon").is_err());
    }
}
