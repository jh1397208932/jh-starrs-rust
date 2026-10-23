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
import { loadMemory, MEMORY_KEYS, saveMemory } from "@/api/memory";

/** 9 套主题预设（data-theme）：mist 为第十一轮「雾光笺」默认主题 */
export const THEME_NAMES = [
  "mist",
  "azure",
  "midnight",
  "amber",
  "forest",
  "rose",
  "violet",
  "graphite",
  "sunset",
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** 2 种明暗模式（data-mode） */
export const THEME_MODES = ["light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  mist: "雾光青",
  azure: "晴空蓝",
  midnight: "星澜紫",
  amber: "暖砂金",
  forest: "苔屿绿",
  rose: "樱雾粉",
  violet: "暮霭紫",
  graphite: "石墨灰",
  sunset: "晨光橙",
};

/** 默认外观；全局库没有记忆时使用 */
const DEFAULT_THEME: ThemeName = "mist";
const DEFAULT_MODE: ThemeMode = "light";

/** 第十一轮「雾光笺」设计语言版本；旧默认主题 sunset 无版本号时一次性升级到 mist */
const DESIGN_VERSION = "2";
/** 上一版默认主题（用户未主动改主题时曾自动写入该值） */
const LEGACY_DEFAULT_THEME: ThemeName = "sunset";

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
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE);
  /** 最近一次指针按下位置（视口坐标），作为揭示圆心 */
  const pointerOrigin = useRef({ x: 0, y: 0 });
  /** 是否已完成记忆读取；完成前不写盘，避免用默认值覆盖用户设置 */
  const hydrated = useRef(false);
  /** 最近一次已知落盘值，用于跳过“加载后无变化”的首次保存 */
  const lastSaved = useRef({ theme: DEFAULT_THEME, mode: DEFAULT_MODE });

  useEffect(() => {
    const recordPointer = (e: PointerEvent) => {
      pointerOrigin.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", recordPointer);
    return () => window.removeEventListener("pointerdown", recordPointer);
  }, []);

  // 启动读取：主题与明暗来自统一记忆 API；失败（如浏览器 dev）保留默认值。
  // 不做“只请求一次 + 卸载取消”的组合：StrictMode 会先清理首个 effect，
  // 若用 ref 阻止第二次请求，首个请求又因 cancelled 被丢弃，hydrated 永远不会置位。
  useEffect(() => {
    void loadMemory()
      .then((memory) => {
        const storedTheme = memory[MEMORY_KEYS.theme];
        const storedMode = memory[MEMORY_KEYS.mode];
        const hasDesignVersion = Boolean(memory[MEMORY_KEYS.designVersion]);
        // 旧版默认主题 sunset 从未被主动选择过：随设计语言版本一次性升级到 mist。
        const migrateLegacyDefault = !hasDesignVersion && storedTheme === LEGACY_DEFAULT_THEME;
        const nextTheme = migrateLegacyDefault
          ? DEFAULT_THEME
          : storedTheme && (THEME_NAMES as readonly string[]).includes(storedTheme)
            ? (storedTheme as ThemeName)
            : DEFAULT_THEME;
        const nextMode =
          storedMode && (THEME_MODES as readonly string[]).includes(storedMode)
            ? (storedMode as ThemeMode)
            : DEFAULT_MODE;
        hydrated.current = true;
        lastSaved.current = { theme: nextTheme, mode: nextMode };
        setThemeState(nextTheme);
        setModeState(nextMode);
        if (migrateLegacyDefault) {
          void saveMemory({
            [MEMORY_KEYS.theme]: nextTheme,
            [MEMORY_KEYS.mode]: nextMode,
            [MEMORY_KEYS.designVersion]: DESIGN_VERSION,
          }).catch(() => {
            // 迁移写入失败不阻断本次显示；下次启动会再次尝试。
          });
        }
      })
      .catch(() => {
        // 全局库不可用时不阻断使用：本次以默认外观运行，下一次修改会重新尝试保存。
        hydrated.current = true;
      });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // 记忆写入：去抖 150ms，合并连续点击；落盘失败不阻断当前换肤。
  useEffect(() => {
    if (!hydrated.current) return;
    if (lastSaved.current.theme === theme && lastSaved.current.mode === mode) return;
    lastSaved.current = { theme, mode };
    const timer = window.setTimeout(() => {
      void saveMemory({
        [MEMORY_KEYS.theme]: theme,
        [MEMORY_KEYS.mode]: mode,
        [MEMORY_KEYS.designVersion]: DESIGN_VERSION,
      }).catch(() => {
        // 主题已在内存生效；保存失败时下次修改会再次尝试。
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [theme, mode]);

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
