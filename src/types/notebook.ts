/**
 * 领域类型 · 笔记本（工作空间/知识库/文档树）—— 跨 feature 共享的领域契约。
 *
 * 这些类型描述业务概念本身，与数据来源解耦：当前由 src/mocks/ 提供 mock 常量，
 * 接入 Rust IPC 后由 src/api/ 封装层返回同构数据（字段即命令返回契约，
 * 见 docs/开发/架构说明.md §3）。禁止在 mocks 或组件文件中重复定义本文件已有类型。
 */

/** 节点 / 标签类型：文档 · 画板 · 表格 */
export type NodeKind = "doc" | "board" | "table";

export interface Workspace {
  id: string;
  name: string;
  path: string;
  /** CSS 变量引用（如 var(--primary)），随主题联动 */
  avatarColor: string;
  isCurrent: boolean;
}

export interface KnowledgeBase {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  docCount: number;
  isCurrent: boolean;
}

export interface NodeItem {
  id: string;
  kbId: string;
  title: string;
  kind: NodeKind;
  updatedAt: string;
  wordCount: number;
  starred: boolean;
}

/** 侧栏树：单层文件夹 + 子项 */
export interface FolderEntry {
  id: string;
  kind: "folder";
  title: string;
  children: NodeItem[];
}

export type TreeEntry = FolderEntry | NodeItem;

/** 标签页；kind 额外允许 "starred"（收藏列表虚拟页） */
export interface TabItem {
  id: string;
  kind: NodeKind | "starred";
  title: string;
  /** 关联的树节点 id；虚拟页/未命名暂存为 null */
  nodeId: string | null;
}

/** 设置-存储弹窗的单行统计（value 单位 MB） */
export interface KbStorageStat {
  label: string;
  value: number;
}

/** 工具栏「目录」下拉的大纲标题 */
export interface OutlineHeading {
  id: string;
  text: string;
  level: 1 | 2;
}

/** 信息面板「相关」tab 的相关文档条目 */
export interface RelatedItem {
  id: string;
  title: string;
  kbName: string;
}
