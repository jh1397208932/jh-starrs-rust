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
  ImportScanResult,
  WriteExportFileParams,
} from "@/types/exchange";

/**
 * 导出单个文档。
 * @param params 文档 id、格式与 Rust 签发的路径令牌
 * @returns 输出文件列表与警告
 * @example await exportDocument({ nodeId, format: "markdown", token });
 */
export async function exportDocument(params: {
  nodeId: string;
  format: ExportFormat;
  token: string;
}): Promise<ExportResult> {
  return invokeCommand<ExportResult>("export_document", {
    input: {
      nodeId: params.nodeId,
      format: params.format,
      token: params.token,
    },
  });
}

/**
 * 按文件树导出整个知识库。
 * @param params 知识库 id、格式与目录令牌
 * @returns 根目录、文件列表与警告
 * @example await exportKnowledgeBase({ knowledgeBaseId, format: "markdown", token });
 */
export async function exportKnowledgeBase(params: {
  knowledgeBaseId: string;
  format: ExportFormat;
  token: string;
}): Promise<ExportResult> {
  return invokeCommand<ExportResult>("export_knowledge_base", {
    input: {
      knowledgeBaseId: params.knowledgeBaseId,
      format: params.format,
      token: params.token,
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
 * 混合导入预扫描：只读分类，列出会导入的文档/画板/导图/附件与将跳过的文件。
 * @param folderPath 用户选择的文件夹绝对路径
 * @returns 分类计数与跳过项
 * @example const scan = await scanImportFolder("/Users/me/笔记");
 */
export async function scanImportFolder(folderPath: string): Promise<ImportScanResult> {
  return invokeCommand<ImportScanResult>("import_scan_folder", { folderPath });
}

/**
 * 写入桌面端渲染的导出文件（画板 PNG/SVG/Excalidraw）。
 * @param params 路径令牌、目标路径与 base64 内容
 * @returns 已写入文件路径与类型
 * @example await writeExportFile({ token, path: "/Users/me/画板.png", dataBase64 });
 */
export async function writeExportFile(params: WriteExportFileParams): Promise<ExportFile> {
  return invokeCommand<ExportFile>("export_write_file", {
    input: {
      token: params.token,
      path: params.path,
      dataBase64: params.dataBase64,
      overwrite: params.overwrite ?? false,
    },
  });
}
