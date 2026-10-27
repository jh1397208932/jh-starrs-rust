/** 客户端内置 MCP 服务：状态、开关与令牌。 */

import type { McpStatus } from "@/types/ai";
import { invokeCommand } from "./client";

/**
 * 读取 MCP 服务状态。
 * @returns 开关、运行状态、端点、令牌与错误
 * @example const status = await getMcpStatus()
 */
export function getMcpStatus(): Promise<McpStatus> {
  return invokeCommand<McpStatus>("mcp_status");
}

/**
 * 开关客户端内置的 MCP 服务。
 * @param enabled true 启动监听，false 停止
 * @returns 操作后的最新状态
 * @example await setMcpEnabled(false)
 */
export function setMcpEnabled(enabled: boolean): Promise<McpStatus> {
  return invokeCommand<McpStatus>("mcp_set_enabled", { enabled });
}

/**
 * 重置 MCP 访问令牌；旧令牌立即失效。
 * @returns 带新令牌的最新状态
 * @example const status = await regenerateMcpToken()
 */
export function regenerateMcpToken(): Promise<McpStatus> {
  return invokeCommand<McpStatus>("mcp_regenerate_token");
}
