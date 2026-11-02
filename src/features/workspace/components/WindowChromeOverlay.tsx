import { IS_MAC } from "@/lib/platform";
import { WindowControls } from "./WindowControls";

export interface WindowChromeOverlayProps {
  /** Tauri Window API 不可用（浏览器 dev）时的降级提示 */
  onWindowFallback: (label: string) => void;
}

/**
 * 启动 / 引导 / 错误页的窗口 chrome。
 *
 * 主界面由 `WindowBar` 承载标签页与窗口按钮；这些早期页面没有顶栏，
 * 在 Windows/Linux 的无边框窗口里必须补一条拖拽带与最小化/最大化/关闭，
 * 否则用户只能依赖任务栏或 Alt+F4。macOS 由系统红绿灯提供，返回 null。
 */
export function WindowChromeOverlay({ onWindowFallback }: WindowChromeOverlayProps) {
  if (IS_MAC) return null;

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-50 flex h-[44px] items-center justify-end select-none"
    >
      <WindowControls onWindowFallback={onWindowFallback} />
    </div>
  );
}
