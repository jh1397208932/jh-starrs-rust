/**
 * 帧率探针（仅性能测量构建启用）。
 *
 * 构建：`VITE_FRAME_PROBE=1 npm run tauri build -- --debug --no-bundle`。
 * 口径：每 5s 一条 `info [perf] frames=… fps=… p50=… p95=… max=… gt16=… gt33=…`，
 * 与 `test/perf/run.mjs` 的解析格式一致；正常构建里整段逻辑被裁掉。
 */

import { formatFrameSummary } from "@/lib/frameSummary";
import { logInfo } from "@/lib/logger";

/** 单个汇总窗口时长；与 run.mjs 的“每窗口覆盖 5s”约定一致。 */
const WINDOW_MS = 5_000;
const ENABLED = import.meta.env.VITE_FRAME_PROBE === "1";

/** 安装帧率探针；未启用时是空操作。 */
export function installFrameProbe(): void {
  if (!ENABLED || typeof window === "undefined") return;

  let frames = 0;
  let gt16 = 0;
  let gt33 = 0;
  let maxFrame = 0;
  let intervals: number[] = [];
  let windowStart = performance.now();
  let last = windowStart;

  const tick = (now: number) => {
    const delta = now - last;
    last = now;
    // 后台挂起/窗口遮挡会制造多秒级间隔，计入会污染 p50/p95；忽略 1s 以上样本。
    if (delta > 0 && delta < 1_000) {
      frames += 1;
      intervals.push(delta);
      if (delta > 16.7) gt16 += 1;
      if (delta > 33.4) gt33 += 1;
      if (delta > maxFrame) maxFrame = delta;
    }
    if (now - windowStart >= WINDOW_MS) {
      logInfo(
        "perf",
        formatFrameSummary({
          frames,
          gt16,
          gt33,
          max: maxFrame,
          elapsedMs: now - windowStart,
          intervals,
        }),
      );
      frames = 0;
      gt16 = 0;
      gt33 = 0;
      maxFrame = 0;
      intervals = [];
      windowStart = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame((now) => {
    last = now;
    windowStart = now;
    requestAnimationFrame(tick);
  });
}
