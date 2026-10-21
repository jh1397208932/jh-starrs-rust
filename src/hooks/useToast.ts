import { useCallback, useEffect, useRef, useState } from "react";

/** Toast 状态：底部居中提示，3s 自动消失 */
export interface ToastState {
  id: number;
  message: string;
  kind: "primary" | "destructive";
  /** 快捷键提示徽标（如 "⌘D"），无则不渲染 */
  kbd?: string;
}

/**
 * 全局 Toast 状态机（原 App.tsx 内联实现，抽为可复用 hook）。
 * showToast 写入提示并重置 3s 自动消失定时器；
 * 组件卸载时清理定时器，避免卸载后回调触发 setState。
 * @returns toast 当前状态（null = 无提示）与 showToast 触发函数
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string, kind: ToastState["kind"] = "primary", kbd?: string) => {
    window.clearTimeout(timerRef.current);
    setToast({ id: Date.now(), message, kind, kbd });
    timerRef.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  // 卸载时清理未触发的定时器
  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return { toast, showToast };
}
