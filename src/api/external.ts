/** 打开外部链接：只允许安全协议，交给系统默认浏览器处理。 */

import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "./urlSafety";

/**
 * 用系统默认浏览器打开链接。
 * @param url 主题里的超链接（仅允许 http/https/mailto）
 * @returns 是否成功交给系统打开
 * @example await openExternalUrl("https://xmind.app")
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const target = safeExternalUrl(url);
  if (!target) return false;
  try {
    await openUrl(target);
    return true;
  } catch {
    return false;
  }
}
