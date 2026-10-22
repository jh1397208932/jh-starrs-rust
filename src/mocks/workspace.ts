/**
 * Mock 数据层 · 与工作区持久化无关的展示常量。
 *
 * 工作区/知识库/文件树已接入 Rust SQLite，禁止再在这里定义相关假数据。
 */

import type { OutlineHeading, RelatedItem } from "@/types/notebook";

/** 工具栏「目录」下拉的占位大纲（文档正文解析尚未接入） */
export const MOCK_OUTLINE: OutlineHeading[] = [
  { id: "h-1", text: "从一个想法开始", level: 1 },
  { id: "h-2", text: "设计令牌体系", level: 2 },
  { id: "h-3", text: "快捷键约定", level: 2 },
];

/** 信息面板「相关」tab 的占位数据（反链留空 → 走空状态） */
export const MOCK_RELATED: RelatedItem[] = [
  { id: "rel-1", title: "Phase2 交互规范评审记录", kbName: "产品灵感库" },
  { id: "rel-2", title: "组件命名约定", kbName: "技术手账" },
];
