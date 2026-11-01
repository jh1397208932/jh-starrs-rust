import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { loadMemory, MEMORY_KEYS, saveMemory } from "@/api/memory";
import { enUS } from "./messages/en-US";
import { platformizeShortcutText } from "./platform";

export type Locale = "zh-CN" | "en-US";

const MESSAGES: Record<Locale, Record<string, string>> = {
  "zh-CN": {},
  "en-US": enUS,
};

const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

let activeLocale: Locale = "zh-CN";
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return activeLocale;
}

/** 只设置内存中的语言；持久化由设置页负责。 */
export function setActiveLocale(locale: Locale) {
  if (locale === activeLocale) return;
  activeLocale = locale;
  document.documentElement.lang = locale;
  notify();
}

function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/**
 * 翻译一段中文源文案；英文缺失时回退中文，避免界面出现空字符串。
 * @param source 中文源文案，作为字典键
 * @param vars 插值变量；源文案中用 `{name}` 占位
 * @returns 当前语言文案
 * @example t("已导出 {count} 个文件", { count: 3 })
 */
const SERVER_PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [
    /^附件仍被 (\d+) 个位置引用，请先解除引用$/,
    (match) => `Attachment is used in ${match[1]} places. Remove references first.`,
  ],
];

export function t(source: string, vars?: Record<string, string | number>): string {
  const translated = MESSAGES[activeLocale][source] ?? source;
  const output = interpolate(platformizeShortcutText(translated), vars);
  if (output === source && activeLocale === "en-US") {
    for (const [pattern, render] of SERVER_PATTERNS) {
      const match = output.match(pattern);
      if (match) return render(match);
    }
  }
  return output;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: typeof t;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** 语言 Provider：启动时读取记忆；切换时立即广播并落盘。 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    let active = true;
    loadMemory()
      .then((memory) => {
        const saved = memory[MEMORY_KEYS.locale];
        if (active && (saved === "zh-CN" || saved === "en-US") && saved !== activeLocale) {
          setActiveLocale(saved);
        }
      })
      .catch(() => {
        // 记忆读取失败时保持中文，不影响启动。
      });
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setActiveLocale(next);
    try {
      await saveMemory({ [MEMORY_KEYS.locale]: next });
    } catch {
      // 写盘失败不回滚界面语言；下次启动会回到已保存值。
    }
  }, []);

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

/** 组件内读取当前语言与翻译函数。 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return context;
}

export { LOCALE_LABELS };
