/**
 * 画板 IPC 封装：场景加载、自动保存、视口保存。
 * 组件禁止直接 invoke，统一经 api 层。
 */

import { invokeCommand } from "@/api/client";
import type {
  BoardLoadResult,
  BoardSaveInput,
  BoardSaveResult,
  BoardSaveViewportParams,
  BoardViewport,
} from "@/types/board";

/**
 * 加载画板场景、视口与图片对象。
 * @param nodeId 画板节点 id
 * @returns 场景、对象 dataURL 与缺失 object_id
 * @example const board = await loadBoard(nodeId);
 */
export async function loadBoard(nodeId: string): Promise<BoardLoadResult> {
  return invokeCommand<BoardLoadResult>("board_load", { nodeId });
}

/**
 * 保存画板场景；不携带文件字节。
 * @param input 节点、基础版本、图元与画布设置
 * @returns 新版本与保存时间
 * @example await saveBoard({ nodeId, baseVersion: 1, elements, appState });
 */
export async function saveBoard(input: BoardSaveInput): Promise<BoardSaveResult> {
  return invokeCommand<BoardSaveResult>("board_save", { input });
}

/**
 * 只保存视口。
 * @param params 节点与 scroll/zoom
 * @returns 后端确认的视口
 * @example await saveBoardViewport({ nodeId, scrollX: 0, scrollY: 0, zoom: 1 });
 */
export async function saveBoardViewport(params: BoardSaveViewportParams): Promise<BoardViewport> {
  return invokeCommand<BoardViewport>("board_save_viewport", { input: params });
}
