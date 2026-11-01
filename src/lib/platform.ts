/**
 * 运行平台判定与快捷键文案的平台化处理。
 *
 * 这是全前端唯一的平台嗅探入口：组件不再各自读取 userAgent，
 * 避免「macOS 红绿灯」「⌘ 键帽」等平台假设散落各处。
 */

const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;

/** 是否运行在 macOS（WKWebView 的系统窗口红绿灯与 ⌘ 键位）。 */
export const IS_MAC = /Macintosh|Mac OS X/i.test(userAgent);

/** 是否运行在 Windows（WebView2 的自绘窗口控制与 Ctrl 键位）。 */
export const IS_WINDOWS = /Windows/i.test(userAgent);

/** 是否运行在 Linux（GTK WebView 的自绘窗口控制）。 */
export const IS_LINUX = !IS_MAC && !IS_WINDOWS && /Linux|X11/i.test(userAgent);

/** 主修饰键的显示文案：macOS 用 ⌘，其他平台用 Ctrl。 */
export const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

/**
 * 把含 macOS 键位符号的文案转换成当前平台可读的文本。
 *
 * 仅用于展示层（例如 i18n 文案里的「更多 ⌘J」）；组合键的解析与匹配
 * 仍以 `Mod` 等逻辑标识为准，见 `features/shortcuts/shortcutKeys.ts`。
 *
 * @param text 含 `⌘` `⌥` `⇧` `⌃` 的展示文案
 * @returns macOS 原样返回；Windows/Linux 转成 Ctrl/Alt/Shift 组合
 * @example platformizeShortcutText("更多 ⌘J") // Windows: "更多 Ctrl+J"
 */
export function platformizeShortcutText(text: string): string {
  if (IS_MAC) return text;
  // 先处理双修饰键组合，避免「⌘⇧F」被拆成「Ctrl+Shift+F」以外的形态。
  return text
    .replace(/⌘⇧/g, "Ctrl+Shift+")
    .replace(/⌘⌥/g, "Ctrl+Alt+")
    .replace(/⌘/g, "Ctrl+")
    .replace(/⌃/g, "Ctrl+")
    .replace(/⌥/g, "Alt+")
    .replace(/⇧/g, "Shift+");
}

/**
 * 把用户可见的键帽片段转换成当前平台的文案。
 * 用于 `["⌘", "D"]` 这类手写的只读快捷键展示。
 *
 * @param key 单个键帽文案
 * @returns 平台化后的键帽
 * @example platformKey("⌘") // Windows: "Ctrl"
 */
export function platformKey(key: string): string {
  if (IS_MAC) return key;
  return platformizeShortcutText(key).replace(/\+$/, "");
}
