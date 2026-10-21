export interface ShortcutItem {
  /** 组合键片段，按显示顺序 */
  keys: string[];
  label: string;
}

/** 设置-快捷键 弹窗的行列表（与 UX_SPEC 第 4 节一致） */
export const SHORTCUTS: ShortcutItem[] = [
  { keys: ["⌘", "N"], label: "新建文档" },
  { keys: ["⌘", "K"], label: "快速跳转" },
  { keys: ["⌘", "⇧", "F"], label: "全局搜索" },
  { keys: ["⌘", ","], label: "打开设置" },
  { keys: ["⌘", "W"], label: "关闭当前标签页" },
  { keys: ["⌘", "S"], label: "保存当前文档" },
  { keys: ["⌘", "D"], label: "收藏 / 取消收藏" },
  { keys: ["⌘", "\\"], label: "显示 / 隐藏左侧栏" },
  { keys: ["⌘", "P"], label: "全屏放映当前画板" },
  { keys: ["⌘", "J"], label: "更多菜单" },
  { keys: ["Esc"], label: "关闭弹窗 / 浮层" },
  { keys: ["/"], label: "编辑器内 Slash 命令" },
];
