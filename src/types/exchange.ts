/**
 * 领域类型 · 导出 / 导入。
 *
 * 与 Rust `models::exchange` 的 IPC DTO 一一对应。
 */

/** 导出格式 */
export type ExportFormat = "markdown" | "html" | "docx" | "pdf";

/** 单个输出文件 */
export interface ExportFile {
  path: string;
  /** document / attachment / manifest / metadata / board / board-image */
  kind: string;
}

/** 整库导出中的画板落点；PNG/SVG 由桌面端渲染后写入。 */
export interface BoardExportTarget {
  nodeId: string;
  title: string;
  /** 画板同名目录绝对路径 */
  dirPath: string;
  /** 目录内统一文件名（不含扩展名） */
  baseName: string;
  excalidrawPath: string;
  pngPath: string;
  svgPath: string;
}

/** 导出结果 */
export interface ExportResult {
  /** 单文档为文件路径；整库为根目录 */
  rootPath: string;
  files: ExportFile[];
  attachmentCount: number;
  warnings: string[];
  /** 整库导出中的画板目标；文档导出为空 */
  boards: BoardExportTarget[];
}

/** 用户选择的导出位置与一次性令牌 */
export interface ExportPathGrant {
  token: string;
  path: string;
}

/** 写入前端渲染的导出文件参数 */
export interface WriteExportFileParams {
  token: string;
  path: string;
  dataBase64: string;
  overwrite?: boolean;
}

/** 导入模式 */
export type ImportMode = "files" | "directory";

/** 导入参数 */
export interface ImportDocumentsParams {
  knowledgeBaseId: string;
  parentId: string | null;
  paths: string[];
  mode: ImportMode;
  preserveHierarchy: boolean;
}

/** 单个文件导入结果 */
export interface ImportFileResult {
  sourcePath: string;
  nodeId: string | null;
  title: string;
  ok: boolean;
  message: string | null;
  warnings: string[];
  attachmentCount: number;
}

/** 批量导入汇总 */
export interface ImportResult {
  imported: number;
  failed: number;
  files: ImportFileResult[];
  createdFolderIds: string[];
}
