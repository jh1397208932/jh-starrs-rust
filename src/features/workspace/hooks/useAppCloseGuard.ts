import { useEffect, useRef } from "react";
import { cancelAppExit, confirmAppExit, onExitRequested, onWindowCloseRequested } from "@/api/app";
import { toErrorMessage } from "@/api/client";
import { flushActivePersistence } from "@/features/editor/activeDocument";
import { t } from "@/lib/i18n";

/** 保存等待上限；超过后取消关闭，避免用户卡在无法退出的窗口。 */
const FLUSH_TIMEOUT_MS = 8000;

type ShowToast = (message: string, kind?: "primary" | "destructive") => void;

/**
 * 关闭/退出守卫：窗口关闭与应用退出都先落盘当前文档/画板。
 *
 * 成功则确认退出；失败或超时则取消退出并提示。浏览器 dev 没有 Tauri
 * runtime 时监听注册失败并静默降级，不影响页面。
 *
 * @param showToast 全局 toast 回调
 * @example useAppCloseGuard(showToast);
 */
export function useAppCloseGuard(showToast: ShowToast) {
  const busyRef = useRef(false);
  const toastRef = useRef(showToast);
  toastRef.current = showToast;

  useEffect(() => {
    let disposed = false;
    let unlisteners: Array<() => void> = [];

    /** 等待活动文档落盘；超时返回 null。 */
    const flushWithTimeout = async (): Promise<boolean | null> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          flushActivePersistence(),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), FLUSH_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const attemptExit = async (preventDefault?: () => void) => {
      if (busyRef.current) {
        preventDefault?.();
        return;
      }
      busyRef.current = true;
      preventDefault?.();
      try {
        const saved = await flushWithTimeout();
        if (disposed) return;
        if (saved === null) {
          await cancelAppExit().catch(() => undefined);
          toastRef.current(t("保存超时，已取消关闭"), "destructive");
          return;
        }
        if (!saved) {
          await cancelAppExit().catch(() => undefined);
          toastRef.current(t("文档未保存，已取消关闭"), "destructive");
          return;
        }
        await confirmAppExit();
      } catch (error) {
        await cancelAppExit().catch(() => undefined);
        toastRef.current(toErrorMessage(error), "destructive");
      } finally {
        busyRef.current = false;
      }
    };

    void onWindowCloseRequested((event) => attemptExit(() => event.preventDefault())).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });
    void onExitRequested(() => attemptExit()).then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
      unlisteners = [];
    };
  }, []);
}
