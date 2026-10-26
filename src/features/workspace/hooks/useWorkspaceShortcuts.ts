import { APP_SHORTCUT_ACTIONS } from "@/features/shortcuts/actions";
import { bindingFromEvent } from "@/features/shortcuts/shortcutKeys";
import type { ShortcutConfig } from "@/features/shortcuts/types";

/** 应用级动作处理表：key 为 actions.ts 中的稳定 action id。 */
export type AppShortcutHandlers = Record<string, () => void>;

/**
 * 应用级快捷键规则：由中心配置表驱动，总开关/作用域关闭时不拦截。
 *
 * @param handlers action id → 回调
 * @param config 当前快捷键配置
 * @returns keydown 处理器，配合 useKeyboardShortcuts 挂载
 */
export function useWorkspaceShortcuts(handlers: AppShortcutHandlers, config: ShortcutConfig) {
  return (event: KeyboardEvent) => {
    if (!config.enabled || !config.scopes.app) return;
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    const binding = bindingFromEvent(event);
    if (!binding) return;
    const action = APP_SHORTCUT_ACTIONS.find(
      (candidate) => (config.bindings[candidate.id] ?? "") === binding,
    );
    // 未实现的动作不占用按键；设置页仍展示为“即将推出”。
    if (!action || action.available === false) return;
    const handler = handlers[action.id];
    if (!handler) return;
    event.preventDefault();
    handler();
  };
}
