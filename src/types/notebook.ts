/**
 * 领域类型 · 工作区 / 知识库 / 文件树 —— 前后端共享的领域契约。
 *
 * 字段与 Rust IPC DTO 一一对应（api 层负责映射 `type` 数字与 `kind` 字面量）。
 * 当前数据来源为本地 SQLite（Rust），不再从 mocks 读取。
 */

/** 数据库与 IPC 使用的节点类型数字（需求约定 1~7） */
/** 数据库与 IPC 使用的节点类型数字（4=表格、5=流程图已在 v16 迁移中清除，不再支持） */
export type NodeType = 1 | 2 | 3 | 6 | 7;

/** 前端展示与交互使用的节点类型 */
export type NodeKind = "folder" | "doc" | "board" | "attachment" | "mindmap";

/** 可打开为标签页的节点类型（文件夹不打开标签） */
export type OpenableKind = Exclude<NodeKind, "folder">;

/** 数字类型 → 字面量类型（唯一映射，供 api 层使用） */
export const NODE_KIND_BY_TYPE: Record<NodeType, NodeKind> = {
  1: "folder",
  2: "doc",
  3: "board",
  6: "attachment",
  7: "mindmap",
};

/** 字面量类型 → 数字类型（新建节点时使用） */
export const NODE_TYPE_BY_KIND: Record<NodeKind, NodeType> = {
  folder: 1,
  doc: 2,
  board: 3,
  attachment: 6,
  mindmap: 7,
};

/** 类型中文名（新建菜单、aria-label） */
export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  folder: "文件夹",
  doc: "文档",
  board: "画板",
  attachment: "附件",
  mindmap: "思维导图",
};

/** 新建菜单展示顺序：文件夹在前；附件不作为新建入口。 */
export const NODE_KIND_ORDER: NodeKind[] = ["folder", "doc", "board", "mindmap"];

/** 工作区（全局注册表中的一行） */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  /** CSS 变量引用（如 var(--primary)），随主题联动 */
  avatarColor: string;
  isCurrent: boolean;
  /** 最近打开时间（Unix 毫秒），列表按此倒序 */
  lastOpenedAt: number;
}

/** 知识库（属于当前工作区库） */
export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  /** 非文件夹、非附件节点数 */
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 上传附件的选择方式：逐个文件，或整个文件夹按层级导入。 */
export type UploadMode = "files" | "folder";

/** 文件树节点（平表字段，树由前端按 parentId 组装） */
export interface NodeItem {
  id: string;
  kbId: string;
  /** 根节点为 null */
  parentId: string | null;
  title: string;
  kind: NodeKind;
  /** 根为 1，逐级 +1 */
  level: number;
  /** 从一级到当前的标题路径，如「设计/原型/首页」 */
  path: string;
  /** 同级排序号，从 0 连续递增 */
  sortOrder: number;
  starred: boolean;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 递归树节点（仅前端展示结构） */
export interface TreeNode {
  node: NodeItem;
  children: TreeNode[];
}

/** 标签页；kind 额外允许 "starred"（收藏虚拟页） */
export interface TabItem {
  id: string;
  kind: OpenableKind | "starred";
  title: string;
  /** 关联的树节点 id；虚拟页暂存为 null */
  nodeId: string | null;
}

/** 应用启动一次性数据 */
export interface WorkspaceBootstrap {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  memory: Record<string, string>;
  defaultWorkspaceParent: string;
}

/** 删除工作区结果（目录删除失败以 warning 表达部分成功） */
export interface DeleteWorkspaceResult {
  nextWorkspace: Workspace | null;
  folderRemoved: boolean;
  warning: string | null;
}

/** 拖拽落点：目标父级与同级插入位置 */
export interface TreeDropTarget {
  parentId: string | null;
  index: number;
}

/** 工具栏「目录」下拉的大纲标题 */
export interface OutlineHeading {
  id: string;
  text: string;
  level: 1 | 2;
}
