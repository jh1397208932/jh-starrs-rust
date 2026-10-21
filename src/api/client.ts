import { invoke } from "@tauri-apps/api/core";

/**
 * IPC 调用统一错误：携带命令名与原始错误，供统一 toast / 日志转换使用。
 */
export class ApiError extends Error {
  constructor(
    public readonly command: string,
    public readonly cause: unknown,
  ) {
    super(`命令 ${command} 调用失败`);
    this.name = "ApiError";
  }
}

/**
 * Tauri IPC 唯一出入口（AGENTS.md §3.3）：所有 Rust 命令调用必须经此封装，
 * 组件禁止直接 import @tauri-apps/api。统一错误转换与日志挂载点。
 *
 * mock 阶段尚无 Rust 命令接入，本文件作为唯一出入口预留；首个命令落地时：
 * ①在 `api/<业务域>.ts` 新增封装函数（中文 JSDoc 注明入参/出参/示例）；
 * ②函数体调用 invokeCommand，返回 @/types/notebook 中的领域类型；
 * ③组件改调 api 函数——切换数据源时组件零改动。
 *
 * @param command Rust 命令名，与 src-tauri/src/commands/ 定义一一对应
 * @param args 命令参数对象（可选）
 * @returns 命令返回值，泛型由调用方约束为领域类型
 * @throws ApiError 命令执行失败时抛出（含命令名与原始错误）
 */
export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    // TODO(IPC): 接入日志系统后按模块名记录失败（见 AGENTS.md §10）
    throw new ApiError(command, error);
  }
}
