/** macOS 运行环境判定（SSR/无 navigator 时视为非 mac） */
const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Macintosh");

/**
 * 红绿灯槽位（仅 macOS 渲染）：76px 宽的窗口拖拽注入区 + 淡色胶囊底座。
 * 底座在系统红绿灯失焦变灰时提供视觉承托，避免左上角空旷；
 * 颜色跟随主题 accent（半透明），深浅模式自动适配。
 * 红绿灯本体位置由 tauri.conf.json 的 trafficLightPosition 控制
 * （y 值需与槽位高度配合：h-44px 槽位 + y:16 时按钮垂直居中）。
 * Windows/Linux 返回 null，由 WindowBar 自绘控制按钮替代。
 * @param className 槽位高度类，如 "h-[44px]"（侧栏顶带）或 "h-full"（窗口栏回补）
 */
export function TrafficLightSlot({ className = "" }: { className?: string }) {
  if (!isMac) return null;

  return (
    <div data-tauri-drag-region className={`relative w-[76px] shrink-0 ${className}`} aria-hidden="true">
      {/* 胶囊底座：覆盖三枚红绿灯（x≈12~64px），垂直居中于槽位 */}
      <span className="absolute left-[6px] top-1/2 h-4 w-[58px] -translate-y-1/2 rounded-full bg-accent/70" />
    </div>
  );
}
