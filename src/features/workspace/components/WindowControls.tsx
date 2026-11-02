import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { runWindowAction, subscribeWindowMaximized, windowActions } from "@/lib/window";

export interface WindowControlsProps {
  /** Tauri Window API 不可用（浏览器 dev）时的降级提示 */
  onWindowFallback: (label: string) => void;
}

/** 10×10 线性图标：与 Windows 11 标题栏按钮的视觉重量对齐。 */
const iconProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.1,
  "aria-hidden": true,
} as const;

/** 最小化：一条水平线。 */
function MinimizeGlyph() {
  return (
    <svg {...iconProps}>
      <title>最小化</title>
      <path d="M1 5.25h8" />
    </svg>
  );
}

/** 最大化：单层方框。 */
function MaximizeGlyph() {
  return (
    <svg {...iconProps}>
      <title>最大化</title>
      <rect x="1" y="1" width="8" height="8" />
    </svg>
  );
}

/** 还原：前后叠放的两个方框（Windows 原生形态）。 */
function RestoreGlyph() {
  return (
    <svg {...iconProps}>
      <title>还原窗口</title>
      <path d="M3 3V1h6v6H7" />
      <rect x="1" y="3" width="6" height="6" />
    </svg>
  );
}

/** 关闭：两条对角线。 */
function CloseGlyph() {
  return (
    <svg {...iconProps}>
      <title>关闭</title>
      <path d="M1 1l8 8M9 1L1 9" />
    </svg>
  );
}

/** 普通按钮：中性悬停，与侧栏/顶栏令牌一致。 */
const NEUTRAL_BUTTON =
  "grid h-8 w-[46px] shrink-0 cursor-default place-items-center text-sidebar-foreground transition-colors duration-100 ease-out hover:bg-[var(--window-control-hover)] active:bg-[var(--window-control-active)]";

/**
 * Windows/Linux 自绘窗口控制区（最小化 / 最大化还原 / 关闭）。
 *
 * 布局对齐系统习惯：按钮从顶栏右缘起排列、46×32 命中区、关闭按钮
 * 使用 Win11 的红色悬停反馈；最大化状态来自窗口 resize 事件，
 * 因此系统双击标题栏、贴边布局或快捷键改变尺寸后图标也会同步。
 * macOS 使用系统红绿灯，不渲染本组件。
 */
export function WindowControls({ onWindowFallback }: WindowControlsProps) {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeWindowMaximized((value) => {
      if (!disposed) setMaximized(value);
    }).then((off) => {
      // 订阅完成前组件已卸载：立刻退订，避免悬挂监听。
      if (disposed) off();
      else unsubscribe = off;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  const minimize = () => runWindowAction(windowActions.minimize, t("最小化窗口"), onWindowFallback);
  const toggleMaximize = () =>
    runWindowAction(windowActions.toggleMaximize, t("最大化 / 还原窗口"), onWindowFallback);
  const close = () => runWindowAction(windowActions.close, t("关闭窗口"), onWindowFallback);

  return (
    <div className="ml-0.5 flex h-full shrink-0 items-center" role="toolbar" aria-label={t("窗口控制")}>
      <button type="button" aria-label={t("最小化")} onClick={minimize} className={NEUTRAL_BUTTON}>
        <MinimizeGlyph />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("还原窗口") : t("最大化")}
        onClick={toggleMaximize}
        className={NEUTRAL_BUTTON}
      >
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button
        type="button"
        aria-label={t("关闭")}
        onClick={close}
        className="grid h-8 w-[46px] shrink-0 cursor-default place-items-center text-sidebar-foreground transition-colors duration-100 ease-out hover:bg-[var(--window-close-hover)] hover:text-white active:bg-[var(--window-close-active)]"
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
