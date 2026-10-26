import type { ShortcutAction, ShortcutConfig } from "./types";

/** 应用级快捷键；与 WorkspaceMainController 的动作一一对应。 */
export const APP_SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "app.newNode", label: "新建", scope: "app", defaultBinding: "Mod+N" },
  { id: "app.more", label: "更多菜单", scope: "app", defaultBinding: "Mod+J" },
  { id: "app.settings", label: "打开设置", scope: "app", defaultBinding: "Mod+Comma" },
  { id: "app.closeTab", label: "关闭当前标签", scope: "app", defaultBinding: "Mod+W" },
  { id: "app.save", label: "保存当前文档", scope: "app", defaultBinding: "Mod+S" },
  { id: "app.star", label: "收藏 / 取消收藏", scope: "app", defaultBinding: "Mod+D" },
  { id: "app.sidebar", label: "显示 / 隐藏侧栏", scope: "app", defaultBinding: "Mod+Backslash" },
  { id: "app.quickJump", label: "快速跳转", scope: "app", defaultBinding: "Mod+K" },
  {
    id: "app.globalSearch",
    label: "全局搜索",
    scope: "app",
    defaultBinding: "Mod+Shift+F",
  },
  { id: "app.presentBoard", label: "放映当前画板", scope: "app", defaultBinding: "Mod+P" },
];

/** 编辑器自有快捷键；仅这些动作会被自定义 keymap 接管。 */
export const EDITOR_SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "editor.bold", label: "加粗", scope: "editor", defaultBinding: "Mod+B" },
  { id: "editor.italic", label: "斜体", scope: "editor", defaultBinding: "Mod+I" },
  { id: "editor.underline", label: "下划线", scope: "editor", defaultBinding: "Mod+U" },
  { id: "editor.strike", label: "删除线", scope: "editor", defaultBinding: "Mod+Shift+S" },
  { id: "editor.code", label: "行内代码", scope: "editor", defaultBinding: "Mod+E" },
  { id: "editor.h1", label: "标题 H1", scope: "editor", defaultBinding: "Mod+Alt+1" },
  { id: "editor.h2", label: "标题 H2", scope: "editor", defaultBinding: "Mod+Alt+2" },
  { id: "editor.h3", label: "标题 H3", scope: "editor", defaultBinding: "Mod+Alt+3" },
  { id: "editor.bullet", label: "无序列表", scope: "editor", defaultBinding: "Mod+Shift+8" },
  { id: "editor.ordered", label: "有序列表", scope: "editor", defaultBinding: "Mod+Shift+7" },
  { id: "editor.task", label: "任务列表", scope: "editor", defaultBinding: "Mod+Shift+9" },
  { id: "editor.quote", label: "引用", scope: "editor", defaultBinding: "Mod+Shift+B" },
  { id: "editor.codeBlock", label: "代码块", scope: "editor", defaultBinding: "Mod+Alt+C" },
  { id: "editor.undo", label: "撤销", scope: "editor", defaultBinding: "Mod+Z" },
  { id: "editor.redo", label: "重做", scope: "editor", defaultBinding: "Mod+Shift+Z" },
  { id: "editor.image", label: "插入图片", scope: "editor", defaultBinding: "" },
  { id: "editor.find", label: "文档内查找", scope: "editor", defaultBinding: "Mod+F" },
  { id: "editor.attachment", label: "插入附件", scope: "editor", defaultBinding: "" },
];

/** 画板自有动作；通过 Excalidraw 公共 API 执行。 */
export const BOARD_SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "board.insertAttachment", label: "插入附件", scope: "board", defaultBinding: "Mod+Shift+A" },
  { id: "board.openLibrary", label: "组件库", scope: "board", defaultBinding: "Mod+Shift+L" },
  { id: "board.exportPng", label: "导出 PNG", scope: "board", defaultBinding: "Mod+Shift+E" },
  { id: "board.save", label: "保存画板", scope: "board", defaultBinding: "Mod+S" },
  { id: "board.select", label: "选择工具", scope: "board", defaultBinding: "V" },
  { id: "board.rectangle", label: "矩形工具", scope: "board", defaultBinding: "R" },
  { id: "board.ellipse", label: "椭圆工具", scope: "board", defaultBinding: "O" },
  { id: "board.arrow", label: "箭头工具", scope: "board", defaultBinding: "A" },
  { id: "board.text", label: "文本工具", scope: "board", defaultBinding: "T" },
];

export const ALL_SHORTCUT_ACTIONS: ShortcutAction[] = [
  ...APP_SHORTCUT_ACTIONS,
  ...EDITOR_SHORTCUT_ACTIONS,
  ...BOARD_SHORTCUT_ACTIONS,
];

/** 第三方/未接管的只读内置快捷键；仅展示。 */
export const BUILTIN_SHORTCUTS: { keys: string[]; label: string; group: string }[] = [
  { keys: ["⌘", "Z"], label: "画板撤销", group: "画板内置" },
  { keys: ["⌘", "⇧", "Z"], label: "画板重做", group: "画板内置" },
  { keys: ["⌘", "C"], label: "画板复制", group: "画板内置" },
  { keys: ["⌘", "V"], label: "画板粘贴", group: "画板内置" },
  { keys: ["Delete"], label: "删除选中图元", group: "画板内置" },
  { keys: ["Tab"], label: "表格内跳到下一格", group: "编辑器内置" },
];

/** 默认配置：所有动作使用默认键，三个作用域均启用。 */
export function createDefaultShortcutConfig(): ShortcutConfig {
  const bindings: Record<string, string> = {};
  for (const action of ALL_SHORTCUT_ACTIONS) {
    bindings[action.id] = action.defaultBinding;
  }
  return {
    version: 1,
    enabled: true,
    scopes: { app: true, editor: true, board: true },
    bindings,
  };
}

/** 把持久化 JSON 归一化为完整配置；未知/非法字段回退默认。 */
export function normalizeShortcutConfig(raw: unknown): ShortcutConfig {
  const defaults = createDefaultShortcutConfig();
  if (!raw || typeof raw !== "object") return defaults;
  const value = raw as Record<string, unknown>;
  const scopes = value.scopes as Record<string, unknown> | undefined;
  const bindings = value.bindings as Record<string, unknown> | undefined;
  const next: ShortcutConfig = {
    version: 1,
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    scopes: {
      app: typeof scopes?.app === "boolean" ? scopes.app : true,
      editor: typeof scopes?.editor === "boolean" ? scopes.editor : true,
      board: typeof scopes?.board === "boolean" ? scopes.board : true,
    },
    bindings: { ...defaults.bindings },
  };
  for (const action of ALL_SHORTCUT_ACTIONS) {
    const current = bindings?.[action.id];
    if (typeof current === "string") next.bindings[action.id] = current;
    else if (current === null) next.bindings[action.id] = "";
  }
  return next;
}
