import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** 8 套主题预设（data-theme） */
export const THEME_NAMES = [
  "sunset",
  "azure",
  "midnight",
  "amber",
  "forest",
  "rose",
  "violet",
  "graphite",
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** 2 种明暗模式（data-mode） */
export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  sunset: "暖屿橙",
  azure: "晴空蓝白",
  midnight: "午夜星河",
  amber: "暮岩金",
  forest: "青屿森语",
  rose: "樱屿绯粉",
  violet: "靛夜霓虹",
  graphite: "墨玉石墨",
};

interface ThemeContextValue {
  theme: ThemeName;
  mode: ThemeMode;
  setTheme: (t: ThemeName) => void;
  setMode: (m: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** 支持 View Transitions 的 document 类型（WKWebView/旧引擎无此 API） */
type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => { ready: Promise<void> };
};

/**
 * 以「自点击位置圆形揭示」的方式执行主题更新（View Transitions API，零依赖）。
 * ①引擎不支持或用户偏好减少动效 → 直接同步切换；
 * ②支持 → 截旧帧 → 切换 → 新帧以 (x,y) 为圆心 clip-path circle 展开 500ms。
 * @param update 实际修改 data-theme / data-mode 的同步回调
 * @param x,y 揭示圆心（视口坐标，通常为用户点击位置）
 */
function applyWithCircularReveal(update: () => void, x: number, y: number) {
  const doc = document as ViewTransitionDocument;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition !== "function" || reduceMotion) {
    update();
    return;
  }
  const transition = doc.startViewTransition(update);
  transition.ready
    .then(() => {
      // 覆盖最远角的半径，保证揭示完全
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      document.documentElement.animate(
        {
          clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`],
        },
        {
          duration: 500,
          easing: "cubic-bezier(.25, 1, .5, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {
      // ready 被打断（如快速连续切换）：状态已正确，无需处理
    });
}

/**
 * 主题状态：只写 <html> 的 data-theme / data-mode 两个属性，
 * 变量重算由浏览器完成，无需事件广播。
 * 切换动画：捕获全局 pointerdown 坐标作为圆心，走 View Transitions 圆形揭示
 * （不支持的平台自动降级为直接切换，行为与旧版一致）。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("sunset");
  const [mode, setModeState] = useState<ThemeMode>("light");
  /** 最近一次指针按下位置（视口坐标），作为揭示圆心 */
  const pointerOrigin = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const recordPointer = (e: PointerEvent) => {
      pointerOrigin.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", recordPointer);
    return () => window.removeEventListener("pointerdown", recordPointer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  const setTheme = useCallback((t: ThemeName) => {
    const { x, y } = pointerOrigin.current;
    applyWithCircularReveal(() => setThemeState(t), x, y);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    const { x, y } = pointerOrigin.current;
    applyWithCircularReveal(() => setModeState(m), x, y);
  }, []);

  const toggleMode = useCallback(() => {
    const { x, y } = pointerOrigin.current;
    applyWithCircularReveal(() => setModeState((m) => (m === "light" ? "dark" : "light")), x, y);
  }, []);

  const value = useMemo(
    () => ({ theme, mode, setTheme, setMode, toggleMode }),
    [theme, mode, setTheme, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme 必须在 <ThemeProvider> 内使用");
  return ctx;
}
