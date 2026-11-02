import { IS_MAC } from "@/lib/platform";

/**
 * 红绿灯槽位（仅 macOS 渲染）：76px 宽的窗口拖拽注入区。
 * 不再画胶囊底座 —— 浅色纸面上那块半透明圆角就是多余的“白块”，
 * 系统红绿灯失焦变灰时本身已足够辨识。
 * 红绿灯本体位置由 tauri.conf.json 的 trafficLightPosition 控制
 * （y 值需与槽位高度配合：h-44px 槽位 + y:16 时按钮垂直居中）。
 * Windows/Linux 返回 null，由 WindowBar 自绘控制按钮替代。
 * @param className 槽位高度类，如 "h-[44px]"（侧栏顶带）或 "h-full"（窗口栏回补）
 */
export function TrafficLightSlot({ className = "" }: { className?: string }) {
  if (!IS_MAC) return null;

  return <div data-tauri-drag-region className={`w-[76px] shrink-0 ${className}`} aria-hidden="true" />;
}
