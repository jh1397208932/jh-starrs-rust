import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { EDITOR_SHORTCUT_ACTIONS } from "@/features/shortcuts/actions";
import { bindingFromEvent } from "@/features/shortcuts/shortcutKeys";
import { getEditorShortcutHandler, getShortcutRuntimeConfig } from "@/features/shortcuts/shortcutRuntime";

/**
 * 用户自定义编辑器键位：在 Tiptap 默认键位之前拦截。
 *
 * - 命中已配置动作：执行并阻止默认行为；
 * - 动作被改键/清空时，吞掉它的旧默认键，避免“清空后仍生效”；
 * - 总开关/编辑器作用域关闭时不拦截，保留基础文本编辑。
 */
export const UserKeymap = Extension.create({
  name: "userKeymap",
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            const config = getShortcutRuntimeConfig();
            if (!config.enabled || !config.scopes.editor) return false;
            if (event.defaultPrevented || event.isComposing) return false;
            const binding = bindingFromEvent(event);
            if (!binding) return false;

            const action = EDITOR_SHORTCUT_ACTIONS.find(
              (candidate) => (config.bindings[candidate.id] ?? "") === binding,
            );
            if (action) {
              const handler = getEditorShortcutHandler(action.id);
              if (!handler) return false;
              event.preventDefault();
              handler(this.editor);
              return true;
            }

            // 用户把动作改到别的键或清空后，旧默认键必须失效。
            const shadowed = EDITOR_SHORTCUT_ACTIONS.find(
              (candidate) =>
                candidate.defaultBinding === binding && (config.bindings[candidate.id] ?? "") !== binding,
            );
            if (shadowed) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
