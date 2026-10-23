import { cn } from "@/lib/utils";
import { classifyFile, fileExtensionLabel } from "../utils/fileKind";

export interface FileTypeIconProps {
  /** 文件名（用于扩展名/类型） */
  fileName: string;
  /** MIME，扩展名未知时兜底 */
  mime?: string;
  /** 视觉尺寸：卡片 56×68，长条 36×44 */
  size?: "card" | "row";
  className?: string;
}

/**
 * 星屿文件类型图标：折角页面 + 类型色 + 扩展名标签。
 *
 * 颜色全部由 app.css 的 `--file-accent` 令牌映射；不在组件内写死色值。
 */
export function FileTypeIcon({ fileName, mime = "", size = "card", className }: FileTypeIconProps) {
  const kind = classifyFile(fileName, mime);
  const label = fileExtensionLabel(fileName, kind);
  return (
    <svg
      viewBox="0 0 64 80"
      className={cn("file-glyph", className)}
      data-file-kind={kind}
      data-file-size={size}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="file-glyph__page"
        d="M11 3h28.8L54 17.2V74a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z"
      />
      <path className="file-glyph__fold" d="M40 3v14.2h14" />
      <path className="file-glyph__fold-shadow" d="M40 3v14.2h14" />
      <rect className="file-glyph__strip" x="8" y="62" width="46" height="4" rx="2" />
      <text className="file-glyph__ext" x="32" y="57" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}
