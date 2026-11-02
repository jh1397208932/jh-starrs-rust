/**
 * 交互响应探针（仅性能测量构建启用）。
 *
 * 构建：`VITE_INTERACTION_PROBE=1 npm run tauri build -- --debug --no-bundle`。
 * 口径：
 * - micro：点击捕获 → 本次事件派发与 React 离散提交完成（微任务末尾）；
 * - frame：到下一次 rAF（浏览器可绘制的最近一帧，60Hz 下限约 16.7ms）；
 * - longtask：主线程 ≥50ms 的长任务（引擎支持时）。
 * 正常构建里 `import.meta.env.VITE_INTERACTION_PROBE` 不等于 "1"，整段逻辑被裁掉。
 */

import { logInfo } from "@/lib/logger";

const ENABLED = import.meta.env.VITE_INTERACTION_PROBE === "1";

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "unknown";
  const element = target.closest<HTMLElement>(
    "button,[role='button'],a,input,[role='menuitem'],[role='tab'],[role='option']",
  );
  if (!element) return target.tagName.toLowerCase();
  const label =
    element.getAttribute("aria-label") ??
    element.textContent?.trim().slice(0, 28) ??
    element.tagName.toLowerCase();
  return label.replace(/\s+/g, " ").slice(0, 40) || element.tagName.toLowerCase();
}

/** 安装探针；未启用时是空操作。 */
export function installInteractionProbe(): void {
  if (!ENABLED || typeof window === "undefined") return;

  window.addEventListener(
    "click",
    (event) => {
      const started = performance.now();
      const label = describeTarget(event.target);
      queueMicrotask(() => {
        const micro = performance.now() - started;
        requestAnimationFrame(() => {
          const frame = performance.now() - started;
          logInfo(
            "perf.interaction",
            `click label="${label}" micro=${micro.toFixed(2)}ms frame=${frame.toFixed(2)}ms`,
          );
        });
      });
    },
    true,
  );

  if (typeof PerformanceObserver !== "undefined") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 50) {
            logInfo("perf.interaction", `longtask=${entry.duration.toFixed(1)}ms`);
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // 引擎不支持 longtask：只保留点击读数。
    }
  }
}
