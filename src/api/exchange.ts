/**
 * 导出 / 导入 IPC 封装。
 *
 * 组件不得直接 import @tauri-apps/api（AGENTS.md §3.3）。
 */

import { invokeCommand } from "@/api/client";
import type {
  ExportFile,
  ExportFormat,
  ExportResult,
  ImportDocumentsParams,
  ImportResult,
  WriteExportFileParams,
} from "@/types/exchange";

/**
 * 导出单个文档。
 * @param params 文档 id、格式与用户选择的完整目标路径
 * @returns 输出文件列表与警告
 * @example await exportDocument({ nodeId, format: "markdown", destPath: "/Users/me/a.md" });
 */
export async function exportDocument(params: {
  nodeId: string;
  format: ExportFormat;
  destPath: string;
}): Promise<ExportResult> {
  return invokeCommand<ExportResult>("export_document", {
    input: {
      nodeId: params.nodeId,
      format: params.format,
      destPath: params.destPath,
    },
  });
}

/**
 * 按文件树导出整个知识库。
 * @param params 知识库 id、格式与导出目录
 * @returns 根目录、文件列表与警告
 * @example await exportKnowledgeBase({ knowledgeBaseId, format: "markdown", destDir: "/Users/me/导出" });
 */
export async function exportKnowledgeBase(params: {
  knowledgeBaseId: string;
  format: ExportFormat;
  destDir: string;
}): Promise<ExportResult> {
  return invokeCommand<ExportResult>("export_knowledge_base", {
    input: {
      knowledgeBaseId: params.knowledgeBaseId,
      format: params.format,
      destDir: params.destDir,
    },
  });
}

/**
 * 导入 Markdown / Word 文件或目录。
 * @param params 目标知识库、目标文件夹、来源路径与模式
 * @returns 成功/失败明细
 * @example await importDocuments({ knowledgeBaseId, parentId: null, paths, mode: "files", preserveHierarchy: true });
 */
export async function importDocuments(params: ImportDocumentsParams): Promise<ImportResult> {
  return invokeCommand<ImportResult>("import_documents", {
    input: {
      knowledgeBaseId: params.knowledgeBaseId,
      parentId: params.parentId,
      paths: params.paths,
      mode: params.mode,
      preserveHierarchy: params.preserveHierarchy,
    },
  });
}

/**
 * 写入桌面端渲染的导出文件（画板 PNG/SVG/Excalidraw）。
 * @param params 绝对路径与 base64 内容
 * @returns 已写入文件路径与类型
 * @example await writeExportFile({ path: "/Users/me/画板.png", dataBase64 });
 */
export async function writeExportFile(params: WriteExportFileParams): Promise<ExportFile> {
  return invokeCommand<ExportFile>("export_write_file", {
    input: {
      path: params.path,
      dataBase64: params.dataBase64,
      overwrite: params.overwrite ?? false,
    },
  });
}
