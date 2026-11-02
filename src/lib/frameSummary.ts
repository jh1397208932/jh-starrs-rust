/**
 * 帧率窗口汇总（纯函数）。
 *
 * 输出必须与 `test/perf/run.mjs` 的解析格式完全一致：
 * `frames=N fps=X p50=… p95=… max=… gt16=N gt33=N`。
 * 单独拆成纯模块，便于无窗口烟雾测试钉住格式，避免探针与采集脚本各自漂移。
 */

/** 一个 5s 窗口的原始读数。 */
export interface FrameWindowInput {
  /** 有效帧数（已剔除后台挂起造成的长间隔）。 */
  frames: number;
  /** 超过 16.7ms 的帧数。 */
  gt16: number;
  /** 超过 33.4ms 的帧数。 */
  gt33: number;
  /** 窗口内最大帧间隔（ms）。 */
  max: number;
  /** 窗口实际时长（ms）。 */
  elapsedMs: number;
  /** 窗口内全部有效帧间隔（ms，未排序）。 */
  intervals: readonly number[];
}

/** 取升序数组的分位数；空数组返回 0。 */
export function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
}

/** 汇总成 perf 日志体（不含 `info [perf] ` 前缀）。 */
export function formatFrameSummary(input: FrameWindowInput): string {
  const sorted = [...input.intervals].sort((left, right) => left - right);
  const fps = input.elapsedMs > 0 ? (input.frames / input.elapsedMs) * 1_000 : 0;
  return [
    `frames=${input.frames}`,
    `fps=${fps.toFixed(1)}`,
    `p50=${percentile(sorted, 0.5).toFixed(2)}`,
    `p95=${percentile(sorted, 0.95).toFixed(2)}`,
    `max=${input.max.toFixed(2)}`,
    `gt16=${input.gt16}`,
    `gt33=${input.gt33}`,
  ].join(" ");
}
