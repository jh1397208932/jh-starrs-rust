//! 数据模型与 IPC 契约：数据库内部行、命令入参、命令返回值。
//!
//! 所有跨 IPC 的结构使用 camelCase 字段名，与前端 TypeScript 领域类型一一对应。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub mod attachment;
pub mod board;
pub mod document;
pub mod exchange;
pub mod library;

pub use document::{DocLoadResult, DocSaveResult, SaveDocumentInput};
pub use exchange::{
    BoardExportTarget, ExportDocumentInput, ExportFileDto, ExportFormat, ExportKnowledgeBaseInput,
    ExportResult, ExportWriteFileInput, ImportDocumentsInput, ImportResult,
};

/// 记忆配置中“当前工作区”的保留键；只由工作区统一切换入口写入。
pub const SETTING_CURRENT_WORKSPACE: &str = "current_workspace_id";
/// 主题名记忆键。
pub const SETTING_THEME: &str = "appearance.theme";
/// 明暗模式记忆键。
pub const SETTING_MODE: &str = "appearance.mode";

/// 全局库中的工作区记录。
#[derive(Debug, Clone)]
pub struct WorkspaceRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub avatar_color: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: i64,
}

impl WorkspaceRecord {
    /// 转换为前端 DTO；`current_id` 用于标记当前连接的工作区。
    pub fn to_dto(&self, current_id: Option<&str>) -> WorkspaceDto {
        WorkspaceDto {
            id: self.id.clone(),
            name: self.name.clone(),
            path: self.path.clone(),
            avatar_color: self.avatar_color.clone(),
            is_current: current_id.is_some_and(|id| id == self.id),
            last_opened_at: self.last_opened_at,
        }
    }
}

/// 工作区 IPC 输出。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub avatar_color: String,
    pub is_current: bool,
    pub last_opened_at: i64,
}

/// 工作区库中的知识库行。
#[derive(Debug, Clone)]
pub struct KnowledgeBaseRow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl KnowledgeBaseRow {
    /// 转换为前端 DTO，并附带所属工作区与条目数。
    pub fn to_dto(&self, workspace_id: &str, doc_count: i64) -> KnowledgeBaseDto {
        KnowledgeBaseDto {
            id: self.id.clone(),
            workspace_id: workspace_id.to_string(),
            name: self.name.clone(),
            description: self.description.clone(),
            doc_count,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

/// 知识库 IPC 输出。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeBaseDto {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub description: String,
    /// 非文件夹节点数（文档/画板/表格/流程图）。
    pub doc_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 文件树节点行。
#[derive(Debug, Clone)]
pub struct NodeRow {
    pub id: String,
    pub node_type: i64,
    pub title: String,
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    pub level: i64,
    pub path: String,
    pub sort_order: i64,
    pub starred: bool,
    pub word_count: i64,
    pub create_time: i64,
    pub update_time: i64,
}

impl NodeRow {
    /// 转换为前端 DTO；内容正文不在此阶段下发，只给字数统计。
    pub fn to_dto(&self) -> NodeDto {
        NodeDto {
            id: self.id.clone(),
            knowledge_base_id: self.knowledge_base_id.clone(),
            parent_id: self.parent_id.clone(),
            node_type: self.node_type,
            title: self.title.clone(),
            level: self.level,
            path: self.path.clone(),
            sort_order: self.sort_order,
            starred: self.starred,
            word_count: self.word_count,
            created_at: self.create_time,
            updated_at: self.update_time,
        }
    }
}

/// 文件树节点 IPC 输出；`type` 为需求约定的 1~5 数字。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDto {
    pub id: String,
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub node_type: i64,
    pub title: String,
    pub level: i64,
    pub path: String,
    pub sort_order: i64,
    pub starred: bool,
    pub word_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 应用启动一次性返回：工作区注册表、当前工作区、全部记忆、默认新建父目录。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub workspaces: Vec<WorkspaceDto>,
    pub current_workspace: Option<WorkspaceDto>,
    pub memory: BTreeMap<String, String>,
    pub default_workspace_parent: String,
}

/// 新建工作区入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkspaceInput {
    pub name: String,
    /// 用户选择的目标目录本身（绝对路径）。
    pub path: String,
    #[serde(default)]
    pub avatar_color: String,
}

/// 重命名工作区入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameWorkspaceInput {
    pub id: String,
    pub name: String,
}

/// 删除工作区入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkspaceInput {
    pub id: String,
    /// 是否连同本地文件夹一起删除；默认 false。
    #[serde(default)]
    pub delete_folder: bool,
}

/// 删除工作区结果；部分成功（注册表已删但目录未删）用 warning 表达。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkspaceResult {
    pub next_workspace: Option<WorkspaceDto>,
    pub folder_removed: bool,
    pub warning: Option<String>,
}

/// 新建知识库入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKbInput {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// 修改知识库入参；未提供的字段保持不变。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKbInput {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

/// 删除知识库结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteKbResult {
    pub deleted_nodes: i64,
}

/// 新建节点入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNodeInput {
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub node_type: i64,
    pub title: String,
}

/// 由已上传对象创建附件节点。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAttachmentNodeInput {
    pub knowledge_base_id: String,
    pub parent_id: Option<String>,
    pub object_id: String,
}

/// 修改节点入参；名称与收藏可选。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNodeInput {
    pub id: String,
    pub title: Option<String>,
    pub starred: Option<bool>,
}

/// 拖动移动节点入参；`index` 为目标同级组中的插入位置（0 起）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveNodeInput {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(default)]
    pub index: i64,
}

/// 删除节点结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNodeResult {
    /// 含自身在内的递归删除数量。
    pub deleted_count: i64,
}
