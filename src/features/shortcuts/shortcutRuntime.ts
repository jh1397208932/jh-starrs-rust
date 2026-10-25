import type { Editor } from "@tiptap/core";
import { createDefaultShortcutConfig } from "./actions";
import type { ShortcutConfig } from "./types";

/**
 * 非 React 快捷键消费者（Tiptap 插件）读取的运行时配置。
 * React Provider 在配置变化时写入；编辑器扩展无需重建即可拿到最新键位。
 */
let runtimeConfig: ShortcutConfig = createDefaultShortcutConfig();
let editorHandlers: Record<string, (editor: Editor) => void> = {};

export function setShortcutRuntimeConfig(config: ShortcutConfig) {
  runtimeConfig = config;
}

export function getShortcutRuntimeConfig(): ShortcutConfig {
  return runtimeConfig;
}

/** 文档编辑器挂载时注入动作处理；卸载时清空。 */
export function setEditorShortcutHandlers(handlers: Record<string, (editor: Editor) => void>) {
  editorHandlers = handlers;
}

export function getEditorShortcutHandler(actionId: string) {
  return editorHandlers[actionId];
}
