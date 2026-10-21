/**
 * Mock 数据层 · 工作空间/知识库/文档树（仅数据常量）。
 *
 * 领域类型统一在 @/types/notebook（禁止在此定义类型，AGENTS.md §3.1）；
 * 接入 Rust IPC 后由 @/api/ 封装层替换本文件的 import 来源，组件零改动。
 */

import type {
  KbStorageStat,
  KnowledgeBase,
  OutlineHeading,
  RelatedItem,
  TreeEntry,
  Workspace,
} from "@/types/notebook";

export const MOCK_WORKSPACES: Workspace[] = [
  {
    id: "ws-1",
    name: "星屿工作区",
    path: "~/Starris/星屿工作区",
    avatarColor: "var(--primary)",
    isCurrent: true,
  },
  {
    id: "ws-2",
    name: "个人草稿箱",
    path: "~/Starris/个人草稿箱",
    avatarColor: "var(--logo-c)",
    isCurrent: false,
  },
];

export const MOCK_KBS: KnowledgeBase[] = [
  {
    id: "kb-1",
    workspaceId: "ws-1",
    name: "产品灵感库",
    description: "交互灵感、竞品拆解与设计走查",
    docCount: 4,
    isCurrent: true,
  },
  {
    id: "kb-2",
    workspaceId: "ws-1",
    name: "技术手账",
    description: "Rust / Tauri / 前端工程笔记",
    docCount: 3,
    isCurrent: false,
  },
];

export const MOCK_TREE: TreeEntry[] = [
  {
    id: "folder-1",
    kind: "folder",
    title: "产品灵感库",
    children: [
      {
        id: "node-1",
        kbId: "kb-1",
        title: "Starris 设计系统走查",
        kind: "doc",
        updatedAt: "2026-10-15 16:32",
        wordCount: 2380,
        starred: true,
      },
      {
        id: "node-2",
        kbId: "kb-1",
        title: "首页改版情绪板",
        kind: "board",
        updatedAt: "2026-10-14 11:05",
        wordCount: 0,
        starred: false,
      },
      {
        id: "node-3",
        kbId: "kb-1",
        title: "功能优先级矩阵",
        kind: "table",
        updatedAt: "2026-10-12 09:47",
        wordCount: 0,
        starred: false,
      },
    ],
  },
  {
    id: "folder-2",
    kind: "folder",
    title: "技术手账",
    children: [
      {
        id: "node-4",
        kbId: "kb-2",
        title: "Tauri 2 迁移踩坑记",
        kind: "doc",
        updatedAt: "2026-10-15 20:18",
        wordCount: 4120,
        starred: true,
      },
      {
        id: "node-5",
        kbId: "kb-2",
        title: "Excalidraw 架构图",
        kind: "board",
        updatedAt: "2026-10-11 15:22",
        wordCount: 0,
        starred: false,
      },
      {
        id: "node-6",
        kbId: "kb-2",
        title: "发布流程清单",
        kind: "doc",
        updatedAt: "2026-10-09 08:30",
        wordCount: 860,
        starred: false,
      },
    ],
  },
  {
    id: "node-7",
    kbId: "kb-2",
    title: "会议速记 · 10/16",
    kind: "doc",
    updatedAt: "2026-10-16 14:02",
    wordCount: 320,
    starred: false,
  },
];

/** 设置-存储 弹窗的 5 行条形图数据 */
export const STORAGE_STATS: KbStorageStat[] = [
  { label: "文档", value: 128 },
  { label: "画板", value: 342 },
  { label: "图片附件", value: 596 },
  { label: "缓存", value: 84 },
  { label: "其他", value: 50 },
];

export const STORAGE_TOTAL = STORAGE_STATS.reduce((sum, s) => sum + s.value, 0);

/** 工具栏「目录」下拉的 mock 大纲 */
export const MOCK_OUTLINE: OutlineHeading[] = [
  { id: "h-1", text: "从一个想法开始", level: 1 },
  { id: "h-2", text: "设计令牌体系", level: 2 },
  { id: "h-3", text: "快捷键约定", level: 2 },
];

/** 信息面板「相关」tab 的 mock 数据（反链留空 → 走空状态） */
export const MOCK_RELATED: RelatedItem[] = [
  { id: "rel-1", title: "Phase2 交互规范评审记录", kbName: "产品灵感库" },
  { id: "rel-2", title: "组件命名约定", kbName: "技术手账" },
];
