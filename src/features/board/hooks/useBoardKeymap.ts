import { useEffect, useRef } from "react";
import { BOARD_SHORTCUT_ACTIONS } from "@/features/shortcuts/actions";
import { useShortcutConfig } from "@/features/shortcuts/ShortcutProvider";
import { bindingFromEvent, isEditableTarget } from "@/features/shortcuts/shortcutKeys";

export type BoardShortcutHandlers = Record<string, () => void>;

/**
 * 画板自有动作键位：捕获阶段拦截，避免 Excalidraw 内置监听重复执行。
 *
 * 画板原生键位（撤销/重做/复制粘贴/缩放等）仍由 Excalidraw 管理，未列入动作表。
 */
export function useBoardKeymap(handlers: BoardShortcutHandlers) {
  const { config } = useShortcutConfig();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!config.enabled || !config.scopes.board) return;
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      // 弹窗打开时 Radix 把焦点锁在弹窗内；按焦点归属判断，避免被残留的弹窗 DOM
      // 误伤（打开过一次设置后画板键位不应失效；扫描整棵 DOM 的 role=dialog 不可靠）。
      const activeElement = document.activeElement;
      if (activeElement instanceof Element && activeElement.closest("[role='dialog']")) return;
      const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
      if (isEditableTarget(event.target) && !hasModifier) return;
      if (!hasModifier) {
        // 单键绘图工具只在画布内生效，避免用户操作侧栏/设置时误切工具。
        const canvasRoot = document.querySelector(".board-excalidraw");
        if (!canvasRoot || !(event.target instanceof Node) || !canvasRoot.contains(event.target)) {
          return;
        }
      }
      const binding = bindingFromEvent(event);
      if (!binding) return;

      const action = BOARD_SHORTCUT_ACTIONS.find(
        (candidate) => (config.bindings[candidate.id] ?? "") === binding,
      );
      if (action && handlersRef.current[action.id]) {
        event.preventDefault();
        event.stopPropagation();
        handlersRef.current[action.id]();
        return;
      }

      // 改键/清空后，旧默认键不再落到 Excalidraw。
      const shadowed = BOARD_SHORTCUT_ACTIONS.find(
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
  }, [config]);
}
