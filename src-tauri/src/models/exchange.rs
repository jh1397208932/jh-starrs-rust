//! 导出 / 导入 IPC 契约。
//!
//! 导出格式与导入来源均在这里收口，命令层只做参数转发；
//! 业务规则在 `services::export_service` 与 `services::import_service`。

use serde::{Deserialize, Serialize};

/// 单文档/整库导出格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    /// Markdown，附件放在文档同级的 `attach/` 目录。
    Markdown,
    /// 带内联样式的 HTML，附件使用相对链接。
    Html,
    /// Word（.docx），图片嵌入文档。
    Docx,
    /// PDF，按 A4 排版。
    Pdf,
}

impl ExportFormat {
    /// 文件扩展名（不含点）。
    pub fn extension(self) -> &'static str {
        match self {
            Self::Markdown => "md",
            Self::Html => "html",
            Self::Docx => "docx",
            Self::Pdf => "pdf",
        }
    }

    /// 中文名称，用于导出说明与错误文案。
    pub fn label(self) -> &'static str {
        match self {
            Self::Markdown => "Markdown",
            Self::Html => "HTML",
            Self::Docx => "Word",
            Self::Pdf => "PDF",
        }
    }
}

/// 用户选择的导出位置与一次性令牌。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPathGrantDto {
    pub token: String,
    pub path: String,
}

/// 单文档导出入参；`dest_path` 是用户在保存对话框中选择的完整文件路径。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDocumentInput {
    pub node_id: String,
    pub format: ExportFormat,
    pub dest_path: String,
}

/// 整库导出入参；导出目录由用户选择，后端在目录下创建知识库同名子目录。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportKnowledgeBaseInput {
    pub knowledge_base_id: String,
    pub format: ExportFormat,
    pub dest_dir: String,
}

/// 单个输出文件。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileDto {
    /// 输出文件绝对路径。
    pub path: String,
    /// `document` / `attachment` / `manifest` / `metadata` / `board` / `board-image`。
    pub kind: String,
}

/// 画板在整库导出中的落点；PNG/SVG 由桌面端渲染后写入。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardExportTarget {
    pub node_id: String,
    pub title: String,
    /// 画板同名目录绝对路径。
    pub dir_path: String,
    /// 目录内的统一文件名（不含扩展名）。
    pub base_name: String,
    pub excalidraw_path: String,
    pub png_path: String,
    pub svg_path: String,
}

/// 思维导图在整库导出中的落点；PNG/SVG 由桌面端渲染后写入。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapExportTarget {
    pub node_id: String,
    pub title: String,
    pub dir_path: String,
    pub base_name: String,
    pub native_path: String,
    pub xmind_path: String,
    pub markdown_path: String,
    pub svg_path: String,
    pub png_path: String,
}

/// 整库导出中的附件节点落点。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAttachmentNode {
    pub node_id: String,
    pub object_id: String,
    pub title: String,
    pub path: String,
    pub size: i64,
    pub mime: String,
}

/// 导出结果；前端用它展示路径、附件数与警告。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 单个文件导出时为该文件路径；整库导出时为根目录。
    pub root_path: String,
    pub files: Vec<ExportFileDto>,
    pub attachment_count: usize,
    pub warnings: Vec<String>,
    /// 整库导出中的画板目标；单文件与文档导出为空。
    #[serde(default)]
    pub boards: Vec<BoardExportTarget>,
    /// 整库导出中的思维导图目标；单文件导出为空。
    #[serde(default)]
    pub mindmaps: Vec<MindmapExportTarget>,
    /// 树中附件节点的落点；供 manifest 与前端核对。
    #[serde(default)]
    pub attachment_nodes: Vec<ExportedAttachmentNode>,
}

/// 写入前端已渲染的导出文件（PNG/SVG/Excalidraw）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportWriteFileInput {
    pub path: String,
    /// 文件内容 base64；不支持二进制以外的编码。
    pub data_base64: String,
    #[serde(default)]
    pub overwrite: bool,
}

/// 导入来源：文件列表或目录递归。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    Files,
    Directory,
}

/// 导入入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocumentsInput {
    pub knowledge_base_id: String,
    /// 目标父级；None 表示知识库根级。
    pub parent_id: Option<String>,
    /// 文件或目录绝对路径列表。
    pub paths: Vec<String>,
    pub mode: ImportMode,
    /// 目录导入时是否把相对目录创建为文件夹节点。
    #[serde(default = "default_true")]
    pub preserve_hierarchy: bool,
}

fn default_true() -> bool {
    true
}

/// 单个文件的导入结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileResult {
    pub source_path: String,
    pub node_id: Option<String>,
    pub title: String,
    pub ok: bool,
    pub message: Option<String>,
    pub warnings: Vec<String>,
    pub attachment_count: usize,
}

/// 批量导入汇总。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub failed: usize,
    pub files: Vec<ImportFileResult>,
    pub created_folder_ids: Vec<String>,
}

/// 混合导入跳过项；只含用户可见的相对路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScanSkippedFile {
    pub path: String,
    pub extension: String,
}

/// 混合导入预扫描结果；只读，不创建节点或对象。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportScanResult {
    pub root: String,
    pub total_files: usize,
    /// 会转成文档的 Markdown / Word / PDF
    pub documents: usize,
    /// 会转成画板的 Excalidraw 文件
    pub boards: usize,
    /// 会转成思维导图的 XMind / FreeMind / OPML / Starris 导图
    pub mindmaps: usize,
    /// 被 Markdown 以本地路径引用、会进对象库的附件
    pub attachments: usize,
    /// 不支持且未被引用的文件数（可能大于 `unsupported` 长度）
    pub unsupported_count: usize,
    pub unsupported: Vec<ImportScanSkippedFile>,
}
