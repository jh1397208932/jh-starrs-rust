/**
 * 链接规范化：只允许 http(s)/mailto/tel、站内绝对路径与锚点。
 * 拒绝 javascript:/data: 等可执行协议。
 */

export function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(value)) return `https://${value}`;
  return null;
}
