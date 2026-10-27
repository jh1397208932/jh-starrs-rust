/**
 * 思维导图 IPC 封装。
 *
 * 组件不得直接 invoke；文件路径只通过 Rust 面板令牌传递。
 */

import { invokeCommand } from "@/api/client";
import type { ExportResult, ImportResult } from "@/types/exchange";
import type {
  MindmapContent,
  MindmapLoadResult,
  MindmapSaveInput,
  MindmapSaveResult,
  MindmapSaveViewportParams,
  MindmapViewport,
} from "@/types/mindmap";

/**
 * 加载思维导图。
 * @param nodeId 思维导图节点 id
 * @returns 场景、视口、图片与缺失对象
 * @example const mindmap = await loadMindmap(nodeId);
 */
export async function loadMindmap(nodeId: string): Promise<MindmapLoadResult> {
  return invokeCommand<MindmapLoadResult>("mindmap_load", { nodeId });
}

/**
 * 保存思维导图场景。
 * @param input 节点、基础版本与 canonical 内容
 * @returns 新版本与主题数
 * @example await saveMindmap({ nodeId, baseVersion: 1, content });
 */
export async function saveMindmap(input: MindmapSaveInput): Promise<MindmapSaveResult> {
  return invokeCommand<MindmapSaveResult>("mindmap_save", { input });
}

/**
 * 只保存视口。
 * @param params 节点与 React Flow viewport
 * @returns 后端确认的视口
 * @example await saveMindmapViewport({ nodeId, x: 0, y: 0, zoom: 1 });
 */
export async function saveMindmapViewport(params: MindmapSaveViewportParams): Promise<MindmapViewport> {
  return invokeCommand<MindmapViewport>("mindmap_save_viewport", {
    input: {
      nodeId: params.nodeId,
      x: params.x,
      y: params.y,
      zoom: params.zoom,
    },
  });
}

/**
 * 导出思维导图到一次性路径令牌。
 * @param params 节点、格式与令牌
 * @returns 导出结果
 * @example await exportMindmap({ nodeId, format: "xmind", token });
 */
export async function exportMindmap(params: {
  nodeId: string;
  format: "xmind" | "freemind" | "opml" | "markdown" | "native";
  token: string;
}): Promise<ExportResult> {
  return invokeCommand<ExportResult>("mindmap_export", {
    input: {
      nodeId: params.nodeId,
      format: params.format,
      token: params.token,
    },
  });
}

/**
 * 批量导入思维导图。
 * @param params 目标知识库、文件夹和绝对路径
 * @returns 每个文件/画布的成功与警告
 * @example await importMindmaps({ knowledgeBaseId, parentId: null, paths });
 */
export async function importMindmaps(params: {
  knowledgeBaseId: string;
  parentId: string | null;
  paths: string[];
}): Promise<ImportResult> {
  return invokeCommand<ImportResult>("import_mindmaps", {
    input: {
      knowledgeBaseId: params.knowledgeBaseId,
      parentId: params.parentId,
      paths: params.paths,
    },
  });
}

/** 创建尚未落库时的默认内容。 */
export function createDefaultMindmapContent(): MindmapContent {
  return {
    schemaVersion: 1,
    sheet: {
      id: `sheet-${crypto.randomUUID()}`,
      structure: "balanced",
      theme: "auto",
      root: {
        id: `topic-${crypto.randomUUID()}`,
        text: "中心主题",
        children: [],
      },
    },
  };
}
