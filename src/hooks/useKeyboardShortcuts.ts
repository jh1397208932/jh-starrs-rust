import { useEffect, useRef } from "react";

/**
 * 全局键盘快捷键监听（window keydown）。
 *
 * handler 经 ref 保持最新闭包：监听器只挂载/解绑一次，
 * 避免把 handler 列入 useEffect 依赖导致快捷键使用过程中反复重绑。
 * @param handler 键盘事件处理函数（在组件内定义，可读取最新 state/props）
 */
export function useKeyboardShortcuts(handler: (event: KeyboardEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
