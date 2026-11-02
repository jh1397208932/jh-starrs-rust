//! 思维导图领域数据与 IPC 契约。
//!
//! 场景只保存树结构与展示语义，不保存坐标；坐标由前端布局引擎按结构实时计算。
//! v2 在 v1 树模型上扩展：主题样式、关系线、外框、概要与更多画布结构；
//! 全部新字段可选，v1 内容反序列化后即可无损升级。

use serde::{Deserialize, Serialize};

/// 思维导图结构。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MindmapStructure {
    /// 根主题居中，一级分支左右分布。
    Balanced,
    /// 根主题居左，所有分支向右展开。
    LogicRight,
    /// 根主题居右，所有分支向左展开。
    LogicLeft,
    /// 根主题居上，分支向下展开。
    OrgDown,
    /// 根主题居下，分支向上展开。
    OrgUp,
    /// 树状图：全部向右、无根主题强调。
    Tree,
    /// 时间轴：横向主轴 + 纵向事件。
    Timeline,
    /// 鱼骨图：脊骨 + 45° 骨刺。
    Fishbone,
}

/// 画布主题（分支配色方案）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapTheme {
    /// 缤纷（默认）：导图内部使用独立的高饱和分支色，不随应用主题变化。
    #[default]
    Vivid,
    /// 暖屿分支色。
    Warm,
    /// 雾海分支色。
    Sea,
    /// 单色墨线。
    Mono,
    /// 玫瑰分支色。
    Rose,
    /// 森林分支色。
    Forest,
    /// 天空分支色。
    Sky,
    /// 李子分支色。
    Plum,
}

/// 分支配色模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapBranchColoring {
    /// 按画布主题的分支色循环。
    #[default]
    Theme,
    /// 彩虹分支：一级分支按色相环顺序取色。
    Rainbow,
}

/// 连线样式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapEdgeStyle {
    /// 贝塞尔曲线（默认）。
    #[default]
    Curve,
    /// 正交折线，圆角拐点。
    Polyline,
}

/// 画布背景样式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapBackground {
    /// 点阵（默认）。
    #[default]
    Dots,
    /// 网格。
    Grid,
    /// 纯色无纹理。
    Plain,
}

/// 主题边框形状。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapBorderShape {
    /// 圆角矩形（默认）。
    #[default]
    Rounded,
    /// 下划线（无框，仅文字下一条分支色线）。
    Underline,
    /// 胶囊（全圆角）。
    Pill,
    /// 直角矩形。
    Plain,
}

/// 主题边框宽度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MindmapBorderWidth {
    /// 细（1px）。
    Thin,
    /// 常规（默认，1.5px）。
    #[default]
    Normal,
    /// 加粗（2.5px）。
    Bold,
}

/// 主题样式覆盖；缺省字段回落到主题/分支默认。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapTopicStyle {
    /// 边框颜色：`auto`（跟随分支色）或 12 色板十六进制。
    #[serde(default)]
    pub border_color: String,
    #[serde(default)]
    pub border_shape: MindmapBorderShape,
    /// 填充：`auto` / `none` / 12 色板十六进制（以低透明度渲染）。
    #[serde(default)]
    pub fill: String,
    #[serde(default)]
    pub border_width: MindmapBorderWidth,
}

/// 画布坐标（仅自由主题与手动位置使用；自动布局不持久化坐标）。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapPosition {
    pub x: f64,
    pub y: f64,
}

/// 主题图片引用；字节仍由全局附件对象库管理。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapImage {
    pub object_id: String,
    pub width: f64,
    pub height: f64,
}

/// 一个主题节点。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapTopic {
    pub id: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default)]
    pub link: String,
    #[serde(default)]
    pub markers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<MindmapImage>,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<MindmapTopicStyle>,
    /// 手动位置覆盖（自由主题必填；树主题拖动到空白处后记录）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pos: Option<MindmapPosition>,
    /// 贴纸 id 列表（内置贴纸库）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stickers: Vec<String>,
    #[serde(default)]
    pub children: Vec<MindmapTopic>,
}

/// 关系线：连接树中任意两个主题。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapRelationship {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub label: String,
    /// `auto`（两端分支色渐变）或 12 色板十六进制。
    #[serde(default)]
    pub color: String,
}

/// 外框：圈住同一父主题下的一组兄弟主题。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapBoundary {
    pub id: String,
    pub parent: String,
    pub child_ids: Vec<String>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub color: String,
}

/// 概要：括起一组主题并挂一个悬空结论主题。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapSummary {
    pub id: String,
    pub parent: String,
    pub child_ids: Vec<String>,
    /// 概要主题；不挂在树上，由布局在括号线旁单独摆放。
    pub topic: MindmapTopic,
}

/// 一个画布。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapSheet {
    pub id: String,
    pub structure: MindmapStructure,
    pub theme: MindmapTheme,
    pub root: MindmapTopic,
    #[serde(default)]
    pub branch_coloring: MindmapBranchColoring,
    #[serde(default)]
    pub edge_style: MindmapEdgeStyle,
    #[serde(default)]
    pub background: MindmapBackground,
    #[serde(default)]
    pub show_numbers: bool,
}

/// 持久化场景根结构。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapContent {
    pub schema_version: i64,
    pub sheet: MindmapSheet,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relationships: Vec<MindmapRelationship>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub boundaries: Vec<MindmapBoundary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub summaries: Vec<MindmapSummary>,
    /// 自由主题：不挂在树上，靠 pos 摆放，可带子树。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub free_topics: Vec<MindmapTopic>,
}

/// 加载结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapLoadResult {
    pub node_id: String,
    pub content: MindmapContent,
    pub version: i64,
    pub updated_at: i64,
    pub topic_count: i64,
    /// 未保存过视口时为 null，前端据此决定 fitView 还是恢复上次位置
    pub viewport: Option<MindmapViewportDto>,
    pub images: Vec<MindmapImageDto>,
    pub missing_object_ids: Vec<String>,
}

/// 保存入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapSaveInput {
    pub node_id: String,
    pub base_version: i64,
    pub content: MindmapContent,
}

/// 保存结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapSaveResult {
    pub version: i64,
    pub updated_at: i64,
    pub topic_count: i64,
}

/// 视口 DTO。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapViewportDto {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

/// 视口保存入参。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapSaveViewportInput {
    pub node_id: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
}

/// 加载时回填的图片对象。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindmapImageDto {
    pub id: String,
    pub mime_type: String,
    pub data_url: String,
    pub created: i64,
}

/// 默认视口缩放。
fn default_zoom() -> f64 {
    1.0
}

/// 新建节点尚未保存时使用的默认内容。
pub fn default_content() -> MindmapContent {
    MindmapContent {
        schema_version: 2,
        sheet: MindmapSheet {
            id: format!("sheet-{}", crate::utils::new_id()),
            structure: MindmapStructure::Balanced,
            theme: MindmapTheme::Vivid,
            branch_coloring: MindmapBranchColoring::default(),
            edge_style: MindmapEdgeStyle::default(),
            background: MindmapBackground::default(),
            show_numbers: false,
            root: MindmapTopic {
                id: format!("topic-{}", crate::utils::new_id()),
                text: "中心主题".to_string(),
                note: String::new(),
                labels: Vec::new(),
                link: String::new(),
                markers: Vec::new(),
                image: None,
                collapsed: false,
                style: None,
                pos: None,
                stickers: Vec::new(),
                children: Vec::new(),
            },
        },
        relationships: Vec::new(),
        boundaries: Vec::new(),
        summaries: Vec::new(),
        free_topics: Vec::new(),
    }
}
