/** 编辑器保存状态 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

/** 工具栏目录项；pos 为标题节点在 ProseMirror 文档中的位置 */
export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  pos: number;
}
