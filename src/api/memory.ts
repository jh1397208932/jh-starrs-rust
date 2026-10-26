/**
 * 统一记忆配置 IPC 封装：主题、明暗等跨启动设置。
 * “当前工作区”由 Rust 在切换连接时写入，前端不得通过本模块覆盖。
 */

import { invokeCommand } from "@/api/client";

/** 记忆键常量（与 Rust `models` 中保留键一致） */
export const MEMORY_KEYS = {
  theme: "appearance.theme",
  mode: "appearance.mode",
  /** 设计语言版本：用于把旧默认主题一次性迁移到雾光笺 */
  designVersion: "appearance.designVersion",
  /** 界面语言：zh-CN / en-US */
  locale: "appearance.locale",
  currentWorkspace: "current_workspace_id",
  /** 快捷键配置 JSON（全局） */
  shortcuts: "shortcuts.config",
} as const;

/**
 * 当前知识库记忆键：每个工作区独立，避免切换工作区时互相覆盖。
 * @param workspaceId 工作区 id
 * @returns 形如 `kb.current.<uuid>` 的合法记忆键
 * @example currentKbKey("0199...") // "kb.current.0199..."
 */
export function currentKbKey(workspaceId: string): string {
  return `kb.current.${workspaceId}`;
}

/**
 * 一次性读取全部记忆配置。
 * @returns 键值对象（可能为空）
 * @example const memory = await loadMemory(); memory["appearance.theme"]
 */
export async function loadMemory(): Promise<Record<string, string>> {
  return invokeCommand<Record<string, string>>("memory_load");
}

/**
 * 批量保存记忆配置（单事务）。
 * @param entries 键值对象；键名仅允许字母数字与 `._-`
 * @returns 写入完成
 * @example await saveMemory({ "appearance.theme": "azure", "appearance.mode": "dark" });
 */
export async function saveMemory(entries: Record<string, string>): Promise<void> {
  await invokeCommand<void>("memory_save", { entries });
}
