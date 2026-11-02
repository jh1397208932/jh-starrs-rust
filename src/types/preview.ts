/**
 * 文档内嵌预览：源节点类型、预览 DTO 与更新事件。
 */

export type PreviewKind = "board" | "mindmap";

/** 按画板/思维导图 id 查到的文档预览图；`dataUrl` 可直接给 img。 */
export interface NodePreview {
  nodeId: string;
  dataUrl: string;
  width: number;
  height: number;
  /** 生成时源节点的 update_time */
  sourceUpdatedAt: number;
  /** 源节点在生成后又更新过 */
  stale: boolean;
}

export interface SaveNodePreviewInput {
  nodeId: string;
  dataBase64: string;
  width: number;
  height: number;
  sourceUpdatedAt: number;
}

export interface SaveNodePreviewResult {
  nodeId: string;
  objectId: string;
  width: number;
  height: number;
  sourceUpdatedAt: number;
  updatedAt: number;
}

/** 预览生成完成；同一窗口内的嵌入块据此刷新。 */
export const NODE_PREVIEW_UPDATED_EVENT = "starris:node-preview-updated";

export interface NodePreviewUpdatedDetail {
  kind: PreviewKind;
  nodeId: string;
}
