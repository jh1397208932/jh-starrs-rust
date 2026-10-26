import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { uploadAttachment, uploadAttachmentBytes } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { t } from "@/lib/i18n";
import type { Attachment } from "@/types/attachment";
import type { AttachmentNodeItem } from "../extensions/attachmentTypes";

export type AttachmentUploadKind = "images" | "attachments" | "auto";

export interface UploadInsertOptions {
  kind: AttachmentUploadKind;
  /** 上传完成后插入的位置；缺省使用当前选区 */
  pos?: number;
  onError: (message: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  /** 文档切换/卸载后禁止把旧批次插入新正文。 */
  isCancelled?: () => boolean;
}

export interface UploadInsertResult {
  inserted: number;
  failed: number;
}

function isImage(attachment: Attachment): boolean {
  return attachment.mime.startsWith("image/");
}

function toItem(attachment: Attachment): AttachmentNodeItem {
  return {
    uid:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    attachmentId: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mime: attachment.mime,
  };
}

/** 图片块节点 JSON；不包含 src/data URL。 */
export function buildAttachmentImageNode(attachment: Attachment): JSONContent {
  return {
    type: "attachmentImage",
    attrs: {
      attachmentId: attachment.id,
      name: attachment.name,
      size: attachment.size,
      mime: attachment.mime,
      alt: attachment.name,
      width: 0,
      align: "left",
    },
  };
}

/** 附件块节点 JSON；多文件合并成一个可切换卡片/长条的块。 */
export function buildAttachmentBlockNode(items: AttachmentNodeItem[]): JSONContent {
  return {
    type: "attachmentBlock",
    attrs: {
      items,
      variant: "grid",
      align: "left",
    },
  };
}

function insertNodes(editor: Editor, nodes: JSONContent[], pos?: number) {
  if (editor.isDestroyed || nodes.length === 0) return;
  if (typeof pos === "number") {
    const safePos = Math.min(Math.max(pos, 1), editor.state.doc.content.size);
    editor.chain().focus().insertContentAt(safePos, nodes).run();
    return;
  }
  editor.chain().focus().insertContent(nodes).run();
}

function buildNodes(
  kind: AttachmentUploadKind,
  attachments: Attachment[],
): { nodes: JSONContent[]; skipped: number } {
  if (kind === "images") {
    const images = attachments.filter(isImage);
    return {
      nodes: images.map(buildAttachmentImageNode),
      skipped: attachments.length - images.length,
    };
  }
  if (kind === "attachments") {
    if (attachments.length === 0) return { nodes: [], skipped: 0 };
    return {
      nodes: [buildAttachmentBlockNode(attachments.map(toItem))],
      skipped: 0,
    };
  }
  const images = attachments.filter(isImage);
  const others = attachments.filter((attachment) => !isImage(attachment));
  const nodes = images.map(buildAttachmentImageNode);
  if (others.length > 0) {
    nodes.push(buildAttachmentBlockNode(others.map(toItem)));
  }
  return { nodes, skipped: 0 };
}

/** 路径上传：Slash/右键/文件选择器的统一入口。 */
export async function uploadPathsAndInsert(
  editor: Editor,
  paths: string[],
  options: UploadInsertOptions,
): Promise<UploadInsertResult> {
  if (paths.length === 0) return { inserted: 0, failed: 0 };
  options.onStart?.();
  let uploaded: Attachment[] = [];
  const failures: string[] = [];
  try {
    for (const sourcePath of paths) {
      try {
        uploaded = [...uploaded, await uploadAttachment({ sourcePath, scope: "node" })];
      } catch (caught) {
        failures.push(toErrorMessage(caught));
      }
    }
    const { nodes, skipped } = buildNodes(options.kind, uploaded);
    if (!options.isCancelled?.()) {
      insertNodes(editor, nodes, options.pos);
    }
    if (skipped > 0) {
      failures.push(t("{count} 个文件不是图片，已跳过", { count: skipped }));
    }
    if (failures.length > 0) {
      options.onError(
        t("上传完成 {ok} 个，{failed} 个失败：{error}", {
          ok: uploaded.length,
          failed: failures.length,
          error: failures[0],
        }),
      );
    }
    return { inserted: nodes.length, failed: failures.length };
  } finally {
    options.onEnd?.();
  }
}

/** 粘贴/拖放上传：File 无路径，走 raw bytes IPC。 */
export async function uploadFilesAndInsert(
  editor: Editor,
  files: File[],
  options: UploadInsertOptions,
): Promise<UploadInsertResult> {
  if (files.length === 0) return { inserted: 0, failed: 0 };
  options.onStart?.();
  let uploaded: Attachment[] = [];
  const failures: string[] = [];
  try {
    for (const file of files) {
      try {
        uploaded = [...uploaded, await uploadAttachmentBytes(file)];
      } catch (caught) {
        failures.push(t("{name}：{error}", { name: file.name || t("文件"), error: toErrorMessage(caught) }));
      }
    }
    const { nodes } = buildNodes("auto", uploaded);
    if (!options.isCancelled?.()) {
      insertNodes(editor, nodes, options.pos);
    }
    if (failures.length > 0) {
      options.onError(
        t("上传完成 {ok} 个，{failed} 个失败：{error}", {
          ok: uploaded.length,
          failed: failures.length,
          error: failures[0],
        }),
      );
    }
    return { inserted: nodes.length, failed: failures.length };
  } finally {
    options.onEnd?.();
  }
}

/** 当前选区之后的插入位置；用于 Slash 删除命令文本后捕获。 */
export function currentInsertPos(editor: Editor): number {
  return editor.state.selection.to;
}

/**
 * 把视口坐标解析为正文插入位置。
 *
 * 落点在正文容器之外（左侧树、顶栏等）时返回 null，调用方必须放弃本次插入，
 * 否则把文件拖到侧栏也会被塞进当前文档。
 *
 * @param editor 目标编辑器
 * @param clientX 落点横坐标（视口 CSS 像素）
 * @param clientY 落点纵坐标（视口 CSS 像素）
 * @param host 正文容器元素；用于判定落点是否属于编辑区
 * @returns 可传给 insertContentAt 的位置；null 表示该落点不该插入
 * @example resolveDropInsertPos(editor, 320, 480, editorBoxEl) // 128 | null
 */
export function resolveDropInsertPos(
  editor: Editor,
  clientX: number,
  clientY: number,
  host: HTMLElement | null,
): number | null {
  if (host) {
    const box = host.getBoundingClientRect();
    const inside = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    if (!inside) return null;
  }
  const hit = editor.view.posAtCoords({ left: clientX, top: clientY });
  return hit ? hit.pos : editor.state.doc.content.size;
}
