/**
 * 思维导图快捷键。
 *
 * 键位来自全局快捷键配置；单键只在导图画布内生效，避免侧栏或弹窗误触发。
 */

import { useEffect, useRef } from "react";
import { MINDMAP_SHORTCUT_ACTIONS } from "@/features/shortcuts/actions";
import { useShortcutConfig } from "@/features/shortcuts/ShortcutProvider";
import { bindingFromEvent, isEditableTarget } from "@/features/shortcuts/shortcutKeys";

export type MindmapShortcutHandlers = Record<string, () => void>;

/** 注册配置化导图快捷键。 */
export function useMindmapKeymap(enabled: boolean, handlers: MindmapShortcutHandlers): void {
  const { config } = useShortcutConfig();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const listener = (event: KeyboardEvent) => {
      if (!config.enabled || !config.scopes.mindmap) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (document.querySelector("[role='dialog']")) return;
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (isEditableTarget(event.target) && !hasModifier) return;
      if (!hasModifier) {
        // AXPress/工具栏点击不会把焦点带进画布；焦点在导图视图内或落在 body
        // （未聚焦元素）时都视为画布上下文，否则 Tab/Enter 等单键永远不生效。
        const view = document.querySelector(".mindmap-view");
        const target = event.target instanceof Node ? event.target : null;
        const inContext =
          (view && target && view.contains(target)) ||
          target === document.body ||
          target === document.documentElement;
        if (!view || !inContext) {
          return;
        }
      }
      const binding = bindingFromEvent(event);
      if (!binding) return;
      const action = MINDMAP_SHORTCUT_ACTIONS.find(
        (candidate) => (config.bindings[candidate.id] ?? "") === binding,
      );
      if (action && handlersRef.current[action.id]) {
        event.preventDefault();
        event.stopPropagation();
        handlersRef.current[action.id]();
        return;
      }
      const shadowed = MINDMAP_SHORTCUT_ACTIONS.find(
        (candidate) =>
          candidate.defaultBinding === binding && (config.bindings[candidate.id] ?? "") !== binding,
      );
      if (shadowed) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [config, enabled]);
}
