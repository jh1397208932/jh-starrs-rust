import { FileText, Presentation, Star, Table2 } from "lucide-react";
import type { NodeKind } from "@/types/notebook";

/** 节点/标签类型：树节点为 NodeKind 三类，标签页额外支持 starred（收藏列表页签） */
export type KindIconKey = NodeKind | "starred";

/** 类型 → lucide 图标映射（唯一权威实现，Sidebar 树与 WindowBar 标签页共用） */
const NODE_KIND_ICONS = {
  doc: FileText,
  board: Presentation,
  table: Table2,
  starred: Star,
} as const;

/** 类型 → 中文名称映射（用于 aria-label 与提示文案） */
export const NODE_KIND_LABELS: Record<KindIconKey, string> = {
  doc: "文档",
  board: "画板",
  table: "表格",
  starred: "收藏",
};

export interface NodeKindIconProps {
  /** 节点/标签业务类型 */
  kind: KindIconKey;
  /** 追加到图标上的类名（尺寸与颜色由调用方按上下文控制） */
  className?: string;
}

/**
 * 节点类型图标：按业务类型渲染对应 lucide 图标。
 * @param kind 节点/标签类型（doc | board | table | starred）
 * @param className 图标类名，如 "size-3.5 text-primary"
 */
export function NodeKindIcon({ kind, className }: NodeKindIconProps) {
  const Icon = NODE_KIND_ICONS[kind];
  return <Icon className={className} />;
}
