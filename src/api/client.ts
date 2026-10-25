import { invoke } from "@tauri-apps/api/core";

/**
 * IPC 调用统一错误：优先使用 Rust 返回的中文消息，便于直接 toast。
 */
export class ApiError extends Error {
  constructor(
    public readonly command: string,
    public readonly cause: unknown,
  ) {
    super(resolveMessage(command, cause));
    this.name = "ApiError";
  }
}

/**
 * 从任意错误中提取可展示文案；未知错误回退为通用提示。
 * @param error 捕获到的异常
 * @returns 面向用户的一行中文消息
 * @example toErrorMessage(new ApiError("kb_list", "知识库不存在")) // "知识库不存在"
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "操作失败，请稍后重试";
}

/**
 * Tauri IPC 唯一出入口（AGENTS.md §3.3）：所有 Rust 命令必须经此封装，
 * 组件禁止直接 import @tauri-apps/api。
 *
 * @param command Rust 命令名，与 src-tauri/src/commands/ 一一对应
 * @param args 命令参数对象（可选）
 * @returns 命令返回值；领域类型由调用方泛型约束
 * @throws ApiError 命令执行失败时抛出（消息已转为可展示中文）
 * @example await invokeCommand<Workspace[]>("workspace_list")
 */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new ApiError(command, error);
  }
}

/**
 * 发送 raw IPC 请求（Uint8Array body + ASCII headers），用于二进制上传/预览。
 *
 * @param command Rust 命令名（必须声明 `tauri::ipc::Request` 参数）
 * @param payload 原始字节；避免 JSON 数组/base64 放大
 * @param headers ASCII 元数据头（如 hex 编码的文件名）
 * @returns 命令返回值；raw Response 命令会得到 ArrayBuffer
 * @throws ApiError 命令执行失败时抛出
 * @example await invokeRawCommand<Attachment>("attachment_upload_bytes", bytes, headers)
 */
export async function invokeRawCommand<T>(
  command: string,
  payload: Uint8Array,
  headers: Record<string, string>,
): Promise<T> {
  try {
    return await invoke<T>(command, payload, { headers });
  } catch (error) {
    throw new ApiError(command, error);
  }
}

/** 从 Rust 错误载荷解析消息：字符串直接使用，其他回退通用文案。 */
function resolveMessage(_command: string, cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return "操作失败，请稍后重试";
}
