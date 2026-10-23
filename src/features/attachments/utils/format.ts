/** 附件大小展示：字节转可读单位。 */
export function formatAttachmentBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let next = value / 1024;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next >= 10 ? next.toFixed(0) : next.toFixed(1)} ${units[index]}`;
}
