/** 快捷键作用域：应用、编辑器、画板。 */
export type ShortcutScope = "app" | "editor" | "board" | "mindmap";

/** 可配置动作；id 稳定用于持久化。 */
export interface ShortcutAction {
  id: string;
  label: string;
  scope: ShortcutScope;
  /** 默认组合；空串表示默认不绑定。 */
  defaultBinding: string;
  /** 是否为当前可用动作；占位动作仍展示但标注。 */
  available?: boolean;
}

/** 快捷键配置；存全局 settings 的 shortcuts.config。 */
export interface ShortcutConfig {
  version: 1;
  enabled: boolean;
  scopes: Record<ShortcutScope, boolean>;
  /** actionId → 规范化组合键；空串表示未设置。 */
  bindings: Record<string, string>;
}

/** 录制器/设置页的校验结果。 */
export interface ShortcutValidation {
  ok: boolean;
  message?: string;
}
