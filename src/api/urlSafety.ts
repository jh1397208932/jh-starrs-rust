/** 安全外链判定：只放行 http/https/mailto，供打开浏览器与单测共用。 */

export function safeExternalUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!/^(https?:|mailto:)/i.test(trimmed)) return null;
  return trimmed;
}
