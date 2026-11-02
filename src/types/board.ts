/**
 * 领域类型 · 画板场景与视口。
 *
 * 画板不建文件映射表：图片图元的 fileId 就是全局 object_id。
 */

/** 只持久化 Excalidraw 导出白名单中的画布设置。 */
export interface BoardAppState {
  viewBackgroundColor?: string;
  gridModeEnabled?: boolean;
  gridSize?: number | null;
  gridStep?: number;
}

/** 画板视口。 */
export interface BoardViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/** 加载返回的图片；id 与全局 object_id 相同。 */
export interface BoardFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created: number;
}

export interface BoardLoadResult {
  nodeId: string;
  elements: unknown[];
  appState: BoardAppState;
  viewport: BoardViewport;
  files: BoardFile[];
  version: number;
  updatedAt: number;
  /** 引用了但全局对象库已不存在的 object_id。 */
  missingObjectIds: string[];
}

export interface BoardSaveInput {
  nodeId: string;
  baseVersion: number;
  elements: unknown[];
  appState: BoardAppState;
}

export interface BoardSaveResult {
  version: number;
  updatedAt: number;
  elementCount: number;
}

export interface BoardSaveViewportParams {
  nodeId: string;
  scrollX: number;
  scrollY: number;
  zoom: number;
}

/** 画板保存状态：UI 胶囊与切换守卫共用。 */
export type BoardSaveStatus = "loading" | "saved" | "saving" | "error" | "conflict";

/** 画板单文件导出格式。 */
export type BoardExportFormat = "png" | "svg" | "excalidraw";

/** 画板只需要的最小 Excalidraw API 子集，避免静态 import 整个包。 */
export interface BoardCanvasApi {
  getAppState(): {
    scrollX: number;
    scrollY: number;
    zoom: { value: number };
    width: number;
    height: number;
    viewBackgroundColor?: string;
  };
  getSceneElements(): readonly unknown[];
  getFiles(): Record<string, { id: string; mimeType: string; dataURL: string; created: number }>;
  updateScene(scene: { elements?: readonly unknown[]; appState?: Record<string, unknown> }): void;
  updateLibrary?(opts: { libraryItems: readonly unknown[]; merge?: boolean }): Promise<unknown>;
  /** 切换当前绘图工具；Excalidraw 公共 API。 */
  setActiveTool?(tool: { type: string }): void;
}
