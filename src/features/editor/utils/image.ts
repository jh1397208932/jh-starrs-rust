/**
 * 图片插入工具：本地文件转 data URL，限制 2MB；本期不接附件后端。
 */

import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";

/** 单张图片体积上限（字节） */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

/** 是否为本期支持的图片文件（排除 SVG，避免内联脚本风险） */
export function isSupportedImage(file: File): boolean {
  return SUPPORTED_TYPES.has(file.type);
}

/** 读取文件为 data URL */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片读取失败"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 将文件转为 image 节点；超限/类型不支持时通过 onError 报告并跳过。
 */
export async function buildImageNodes(
  files: File[],
  onError: (message: string) => void,
): Promise<JSONContent[]> {
  const nodes: JSONContent[] = [];
  for (const file of files) {
    if (!isSupportedImage(file)) {
      onError(`不支持 ${file.name || "该文件"} 的图片格式`);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError(`图片 ${file.name || ""} 超过 2MB，暂不支持插入`);
      continue;
    }
    try {
      const src = await readAsDataUrl(file);
      nodes.push({ type: "image", attrs: { src, alt: file.name } });
    } catch {
      onError(`图片 ${file.name || ""} 读取失败`);
    }
  }
  return nodes;
}

/** 在当前选区或指定位置插入图片。 */
export async function insertImageFiles(
  editor: Editor,
  files: File[],
  options: { pos?: number; onError: (message: string) => void },
) {
  const nodes = await buildImageNodes(files, options.onError);
  if (nodes.length === 0 || editor.isDestroyed) return;
  const chain = editor.chain().focus();
  if (options.pos === undefined) chain.insertContent(nodes).run();
  else chain.insertContentAt(options.pos, nodes).run();
}
