/**
 * 文档内嵌预览 IPC 封装。
 */

import { invokeCommand } from "@/api/client";
import type { NodePreview, SaveNodePreviewInput, SaveNodePreviewResult } from "@/types/preview";

/**
 * 按画板 id 查询文档内嵌图片。
 * @param nodeId 画板节点 id
 * @returns 预览；未生成过返回 null
 * @example const image = await getBoardImage(nodeId);
 */
export async function getBoardImage(nodeId: string): Promise<NodePreview | null> {
  return invokeCommand<NodePreview | null>("board_image", { nodeId });
}

/**
 * 按思维导图 id 查询文档内嵌图片。
 * @param nodeId 思维导图节点 id
 * @returns 预览；未生成过返回 null
 * @example const image = await getMindmapImage(nodeId);
 */
export async function getMindmapImage(nodeId: string): Promise<NodePreview | null> {
  return invokeCommand<NodePreview | null>("mindmap_image", { nodeId });
}

/**
 * 写入前端渲染好的预览图。
 * @param input PNG base64、展示尺寸与源更新时间
 * @returns 落库后的预览元信息
 * @example await saveNodePreview({ nodeId, dataBase64, width, height, sourceUpdatedAt });
 */
export async function saveNodePreview(input: SaveNodePreviewInput): Promise<SaveNodePreviewResult> {
  return invokeCommand<SaveNodePreviewResult>("node_preview_save", { input });
}
