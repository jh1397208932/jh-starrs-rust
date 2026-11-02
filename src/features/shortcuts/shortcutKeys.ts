import { t } from "@/lib/i18n";
import type { ShortcutAction, ShortcutScope, ShortcutValidation } from "./types";

const IS_MAC = typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("macintosh");

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Fn", "Dead"]);
const PUNCTUATION_TOKENS: Record<string, string> = {
  ",": "Comma",
  "\\": "Backslash",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",
  ".": "Period",
  "+": "Plus",
};
const TOKEN_LABELS: Record<string, string> = {
  Mod: IS_MAC ? "⌘" : "Ctrl",
  Control: IS_MAC ? "⌃" : "Ctrl",
  Meta: "⌘",
  Alt: IS_MAC ? "⌥" : "Alt",
  Shift: "⇧",
  Comma: ",",
  Backslash: "\\",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Period: ".",
  Plus: "+",
  Space: "Space",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
};

/** 系统/浏览器保留组合；只提示，不猜测平台实际行为。 */
const RESERVED_BINDINGS = new Set(["Mod+Space", "Mod+Tab", "Mod+Q", "Mod+H", "Mod+M", "Mod+Control+F"]);

/** 把键盘事件转成规范组合；仅按修饰键返回 null。 */
export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  const primary = IS_MAC ? event.metaKey : event.ctrlKey;
  if (primary) parts.push("Mod");
  if (IS_MAC && event.ctrlKey) parts.push("Control");
  if (!IS_MAC && event.metaKey) parts.push("Meta");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = keyTokenFromEvent(event);
  if (!key) return null;
  parts.push(key);
  return parts.join("+");
}

/** 键盘事件是否与已保存组合匹配。 */
export function matchesBinding(event: KeyboardEvent, binding: string): boolean {
  if (!binding) return false;
  return bindingFromEvent(event) === binding;
}

/** 组合键 → 显示键帽；空组合返回空数组。 */
export function bindingTokens(binding: string): string[] {
  if (!binding) return [];
  return binding.split("+").map((token) => TOKEN_LABELS[token] ?? token);
}

/** 组合键的可读文本。 */
export function bindingLabel(binding: string): string {
  return bindingTokens(binding).join(" ");
}

/** 校验组合是否可保存。 */
export function validateBinding(binding: string, scope: ShortcutScope): ShortcutValidation {
  if (!binding) return { ok: true };
  if (!bindingFromTokens(binding)) return { ok: false, message: t("组合键格式无效") };
  if (scope === "app" && !/(^|\+)Mod\+|(^|\+)(Control|Meta|Alt)\+/.test(binding)) {
    return { ok: false, message: t("应用快捷键至少需要一个修饰键") };
  }
  if (RESERVED_BINDINGS.has(binding)) {
    return { ok: false, message: t("该组合键通常被系统占用") };
  }
  return { ok: true };
}

/**
 * 只在同一作用域查找冲突动作。
 *
 * 跨作用域撞同一个组合键不算冲突：同一时刻光标只可能在一个标签页里，
 * 谁收到按键由活动标签页决定，运行时也按「tab 内键位优先」派发。
 */
export function findSameScopeConflict(
  actions: ShortcutAction[],
  bindings: Record<string, string>,
  actionId: string,
  scope: ShortcutScope,
  binding: string,
): ShortcutAction | null {
  if (!binding) return null;
  return (
    actions.find(
      (action) => action.id !== actionId && action.scope === scope && (bindings[action.id] ?? "") === binding,
    ) ?? null
  );
}

/** 在动作表中查找当前组合对应的动作。 */
export function findActionByBinding(
  actions: ShortcutAction[],
  bindings: Record<string, string>,
  binding: string,
): ShortcutAction | null {
  if (!binding) return null;
  return actions.find((action) => (bindings[action.id] ?? "") === binding) ?? null;
}

/** 焦点是否在可输入元素中（用于允许单键画板快捷键不打断输入）。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

/**
 * 物理键名优先：macOS Option+字母会产生特殊字符（⌥B → ∫），
 * 用 event.code 避免把输入字符误当成按键标识。
 */
function keyTokenFromEvent(event: KeyboardEvent): string | null {
  const code = event.code;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return code;
  if (code.startsWith("F") && /^F\d{1,2}$/.test(code)) return code;
  if (
    [
      "Space",
      "Escape",
      "Enter",
      "Tab",
      "Backspace",
      "Delete",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Comma",
      "Period",
      "Slash",
      "Backslash",
      "Semicolon",
      "Quote",
      "BracketLeft",
      "BracketRight",
      "Minus",
      "Equal",
      "Backquote",
    ].includes(code)
  ) {
    return code;
  }
  return keyToken(event.key);
}

function keyToken(key: string): string | null {
  if (key.length === 1) {
    return PUNCTUATION_TOKENS[key] ?? key.toUpperCase();
  }
  const special: Record<string, string> = {
    " ": "Space",
    Escape: "Escape",
    Enter: "Enter",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };
  return special[key] ?? key;
}

function bindingFromTokens(binding: string): boolean {
  return binding
    .split("+")
    .filter(Boolean)
    .every(
      (token) =>
        TOKEN_LABELS[token] !== undefined ||
        /^[A-Z0-9]$/.test(token) ||
        /^F\d{1,2}$/.test(token) ||
        /^Numpad[A-Za-z0-9]+$/.test(token),
    );
}

/** 导出平台信息，供设置页显示说明。 */
export const SHORTCUT_PLATFORM_LABEL = IS_MAC ? "macOS" : "Windows/Linux";
