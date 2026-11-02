import { platformKey } from "@/lib/platform";

export interface ShortcutItem {
  /** 组合键片段，按显示顺序 */
  keys: string[];
  label: string;
}

/** 平台主修饰键与 Shift 的键帽（macOS ⌘/⇧，Windows Ctrl/Shift）。 */
const MOD = platformKey("⌘");
const SHIFT = platformKey("⇧");

/** 设置-快捷键 弹窗的行列表（与 UX_SPEC 第 4 节一致） */
export const SHORTCUTS: ShortcutItem[] = [
  { keys: [MOD, "N"], label: "新建文档" },
  { keys: [MOD, "K"], label: "快速跳转（即将推出）" },
  { keys: [MOD, SHIFT, "F"], label: "全局搜索（即将推出）" },
  { keys: [MOD, ","], label: "打开设置" },
  { keys: [MOD, "W"], label: "关闭当前标签页" },
  { keys: [MOD, "S"], label: "保存当前文档" },
  { keys: [MOD, "D"], label: "收藏 / 取消收藏" },
  { keys: [MOD, "\\"], label: "显示 / 隐藏左侧栏" },
  { keys: [MOD, "P"], label: "全屏放映（即将推出）" },
  { keys: [MOD, "J"], label: "更多菜单" },
  { keys: ["Esc"], label: "关闭弹窗 / 浮层" },
  { keys: ["/"], label: "编辑器内插入菜单" },
];
