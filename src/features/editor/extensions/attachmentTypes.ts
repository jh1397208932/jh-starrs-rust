/** 文档图片/附件块共享类型（与 Tiptap JSON attrs 一致）。 */

export type BlockAlign = "left" | "center" | "right";
export type AttachmentVariant = "grid" | "list";

/** 图片块 attrs：不存 src，只存附件 id 与展示元数据。 */
export interface AttachmentImageAttrs {
  attachmentId: string | null;
  name: string;
  size: number;
  mime: string;
  alt: string;
  /** 显示宽度 px；0 表示按自然宽度并受正文宽度约束 */
  width: number;
  align: BlockAlign;
}

/** 附件块内的一项（非 ProseMirror 子节点）。 */
export interface AttachmentNodeItem {
  /** 组内实例 id；用于 React key/重复引用同一附件 */
  uid?: string;
  attachmentId: string;
  name: string;
  size: number;
  mime: string;
}

/** 附件块 attrs。 */
export interface AttachmentBlockAttrs {
  items: AttachmentNodeItem[];
  variant: AttachmentVariant;
  align: BlockAlign;
}

export interface AttachmentNodeViewOptions {
  onError: (message: string) => void;
}

/** 把未知值收窄为合法附件项；用于 HTML parse/容错。 */
export function normalizeAttachmentItem(value: unknown): AttachmentNodeItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const attachmentId = typeof item.attachmentId === "string" ? item.attachmentId.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!attachmentId || !name) return null;
  const size = typeof item.size === "number" && Number.isFinite(item.size) ? item.size : 0;
  const mime = typeof item.mime === "string" ? item.mime : "";
  const uid = typeof item.uid === "string" && item.uid ? item.uid : undefined;
  return { uid, attachmentId, name, size, mime };
}

/** 解析 HTML 中的 items JSON；非法数据回退为空数组。 */
export function parseAttachmentItems(raw: string | null): AttachmentNodeItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAttachmentItem).filter((item): item is AttachmentNodeItem => item !== null);
  } catch {
    return [];
  }
}
