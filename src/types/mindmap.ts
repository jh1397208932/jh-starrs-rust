/**
 * 领域类型 · 思维导图。
 *
 * canonical 树只保存结构与展示语义；React Flow 坐标由布局引擎实时计算。
 * v2 扩展：主题样式、关系线、外框、概要与 8 种画布结构；全部新字段可选，v1 内容可直接打开。
 */

/** 自动布局结构。 */
export type MindmapStructure =
  | "balanced"
  | "logic-right"
  | "logic-left"
  | "org-down"
  | "org-up"
  | "tree"
  | "timeline"
  | "fishbone";

/** 画布主题（分支配色方案）。 */
export type MindmapTheme = "vivid" | "warm" | "sea" | "mono" | "rose" | "forest" | "sky" | "plum";

/** 分支配色模式。 */
export type MindmapBranchColoring = "theme" | "rainbow";

/** 连线样式。 */
export type MindmapEdgeStyle = "curve" | "polyline";

/** 画布背景样式。 */
export type MindmapBackground = "dots" | "grid" | "plain";

/** 主题边框形状。 */
export type MindmapBorderShape = "rounded" | "underline" | "pill" | "plain";

/** 主题边框宽度。 */
export type MindmapBorderWidth = "thin" | "normal" | "bold";

/** 主题样式覆盖；缺省字段回落到主题/分支默认。 */
export interface MindmapTopicStyle {
  /** `auto`（跟随分支色）或 32 色板十六进制 */
  borderColor?: string;
  borderShape?: MindmapBorderShape;
  /** `auto` / `none` / 32 色板十六进制（低透明度渲染） */
  fill?: string;
  borderWidth?: MindmapBorderWidth;
}

/** 主题图片引用；字节位于全局附件对象库。 */
export interface MindmapImage {
  /** 附件 object_id */
  objectId: string;
  /** 显示宽度（CSS px） */
  width: number;
  /** 显示高度（CSS px） */
  height: number;
}

/** 一个主题。 */
export interface MindmapTopic {
  /** topic- 前缀稳定 id */
  id: string;
  /** 主题文本 */
  text: string;
  /** 纯文本备注 */
  note?: string;
  /** 标签 */
  labels?: string[];
  /** http/https/mailto 链接 */
  link?: string;
  /** Starris 标记 id */
  markers?: string[];
  /** 图片主题 */
  image?: MindmapImage | null;
  /** 是否折叠子树 */
  collapsed?: boolean;
  /** 样式覆盖（v2） */
  style?: MindmapTopicStyle | null;
  /** 手动位置覆盖（自由主题必填；树主题拖到空白处后记录） */
  pos?: MindmapPosition | null;
  /** 贴纸 id 列表 */
  stickers?: string[];
  /** 子主题 */
  children?: MindmapTopic[];
}

/** 画布坐标（仅自由主题与手动位置使用）。 */
export interface MindmapPosition {
  x: number;
  y: number;
}

/** 关系线：连接树中任意两个主题。 */
export interface MindmapRelationship {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** `auto`（两端分支色渐变）或 12 色板十六进制 */
  color?: string;
}

/** 外框：圈住同一父主题下的一组兄弟主题。 */
export interface MindmapBoundary {
  id: string;
  parent: string;
  childIds: string[];
  label?: string;
  color?: string;
}

/** 概要：括起一组主题并挂一个悬空结论主题。 */
export interface MindmapSummary {
  id: string;
  parent: string;
  childIds: string[];
  /** 概要主题；不挂在树上，由布局在括号线旁单独摆放。 */
  topic: MindmapTopic;
}

/** 画布。 */
export interface MindmapSheet {
  id: string;
  structure: MindmapStructure;
  theme: MindmapTheme;
  root: MindmapTopic;
  /** 彩虹分支开关（v2） */
  branchColoring?: MindmapBranchColoring;
  /** 连线样式（v2） */
  edgeStyle?: MindmapEdgeStyle;
  /** 画布背景 */
  background?: MindmapBackground;
  /** 一级分支自动编号 */
  showNumbers?: boolean;
}

/** 持久化场景。 */
export interface MindmapContent {
  schemaVersion: 2;
  sheet: MindmapSheet;
  relationships?: MindmapRelationship[];
  boundaries?: MindmapBoundary[];
  summaries?: MindmapSummary[];
  /** 自由主题：不挂在树上，靠 pos 摆放，可带子树 */
  freeTopics?: MindmapTopic[];
}

/** 视口。 */
export interface MindmapViewport {
  x: number;
  y: number;
  zoom: number;
}

/** 加载返回的图片。 */
export interface MindmapFile {
  id: string;
  mimeType: string;
  dataUrl: string;
  created: number;
}

/** 加载结果。 */
export interface MindmapLoadResult {
  nodeId: string;
  content: MindmapContent;
  version: number;
  updatedAt: number;
  topicCount: number;
  /** 未保存过视口时为 null（首次打开/新导图） */
  viewport: MindmapViewport | null;
  images: MindmapFile[];
  missingObjectIds: string[];
}

/** 保存入参。 */
export interface MindmapSaveInput {
  nodeId: string;
  baseVersion: number;
  content: MindmapContent;
}

/** 保存结果。 */
export interface MindmapSaveResult {
  version: number;
  updatedAt: number;
  topicCount: number;
}

/** 视口保存参数。 */
export interface MindmapSaveViewportParams extends MindmapViewport {
  nodeId: string;
}

/** 思维导图导出格式。 */
export type MindmapExportFormat = "xmind" | "freemind" | "opml" | "markdown" | "native" | "svg" | "png";

/** 思维导图保存状态，沿用画板状态语义。 */
export type MindmapSaveStatus = "loading" | "saved" | "saving" | "error" | "conflict";

/** 节点在布局中的方位；timeline/fishbone 复用 left/right/down 语义。 */
export type LayoutSide = "root" | "left" | "right" | "down";

/** 布局后的主题节点。 */
export interface LayoutTopic {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  side: LayoutSide;
  branchIndex: number;
  hiddenCount: number;
  /** 自动编号（如 1 / 1.2），仅 showNumbers 时填充 */
  number?: string;
  /** 是否为自由主题 */
  free?: boolean;
  topic: MindmapTopic;
}

/** 连线的出/入方向；与布局产出的 handle id 一一对应。 */
export type ConnectorSide = "left" | "right" | "up" | "down";

/** 布局后的树形连线。 */
export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: ConnectorSide;
  targetHandle: ConnectorSide;
  branchIndex: number;
  depth: number;
}

/** 布局后的关系线（虚线连接两个主题中心）。 */
export interface LayoutRelationship {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  /** 避让节点后的 SVG path（flow 坐标） */
  path: string;
  /** 端点中心坐标，由布局在节点摆放完成后填充 */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** 布局后的外框几何。 */
export interface LayoutBoundary {
  id: string;
  label?: string;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  memberIds: string[];
}

/** 布局后的概要几何（括号线 + 概要主题已作为节点返回）。 */
export interface LayoutSummary {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 括号朝向：概要在成员右侧或下方 */
  direction: "right" | "down";
}

/** 布局结果。 */
export interface MindmapLayout {
  nodes: LayoutTopic[];
  edges: LayoutEdge[];
  relationships: LayoutRelationship[];
  boundaries: LayoutBoundary[];
  summaries: LayoutSummary[];
  width: number;
  height: number;
}
