import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { loadMemory, MEMORY_KEYS, saveMemory } from "@/api/memory";
import { createDefaultShortcutConfig, normalizeShortcutConfig } from "./actions";
import { setShortcutRuntimeConfig } from "./shortcutRuntime";
import type { ShortcutConfig } from "./types";

interface ShortcutContextValue {
  config: ShortcutConfig;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  saveError: string | null;
  updateConfig: (next: ShortcutConfig) => void;
  resetConfig: () => void;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

/**
 * 全局快捷键配置 Provider：启动时读取 SQLite settings，变更后立即落库。
 * 读取失败回退默认；保存失败保留当前编辑值并暴露错误，不静默丢失。
 */
export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ShortcutConfig>(() => createDefaultShortcutConfig());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMemory()
      .then((memory) => {
        if (cancelled) return;
        const raw = memory[MEMORY_KEYS.shortcuts];
        if (raw) {
          try {
            setConfig(normalizeShortcutConfig(JSON.parse(raw)));
          } catch {
            setLoadError("快捷键配置损坏，已恢复默认");
            setConfig(createDefaultShortcutConfig());
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setLoadError(toErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setShortcutRuntimeConfig(config);
  }, [config]);

  const persist = useCallback((next: ShortcutConfig) => {
    setConfig(next);
    setSaving(true);
    setSaveError(null);
    void saveMemory({ [MEMORY_KEYS.shortcuts]: JSON.stringify(next) })
      .catch((error) => setSaveError(toErrorMessage(error)))
      .finally(() => setSaving(false));
  }, []);

  const resetConfig = useCallback(() => {
    persist(createDefaultShortcutConfig());
  }, [persist]);

  const value = useMemo(
    () => ({
      config,
      loading,
      saving,
      loadError,
      saveError,
      updateConfig: persist,
      resetConfig,
    }),
    [config, loading, loadError, persist, resetConfig, saveError, saving],
  );

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

/** 读取快捷键配置；未包裹 Provider 时直接报错，避免静默使用过期默认值。 */
export function useShortcutConfig(): ShortcutContextValue {
  const value = useContext(ShortcutContext);
  if (!value) throw new Error("useShortcutConfig 必须在 <ShortcutProvider> 内使用");
  return value;
}
