/**
 * 帧率汇总格式烟雾测试（Node 运行，无需窗口）。
 *
 * 契约：`src/lib/frameSummary.ts` 的输出必须能被 `test/perf/run.mjs` 的解析正则完整吃下；
 * 本测试用同一条正则做正/负对照，防止探针与采集脚本各自漂移。
 */

import { formatFrameSummary, percentile } from "@/lib/frameSummary";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

// 与 test/perf/run.mjs 的 value(key) 契约一致：每个字段都必须以 key=数字 出现。
const PERF_BODY = /^frames=(\d+) fps=([0-9.]+) p50=([0-9.]+) p95=([0-9.]+) max=([0-9.]+) gt16=(\d+) gt33=(\d+)$/;

const stable = formatFrameSummary({
  frames: 60,
  gt16: 0,
  gt33: 0,
  max: 16.7,
  elapsedMs: 1_000,
  intervals: Array.from({ length: 60 }, () => 16.7),
});
const matched = PERF_BODY.exec(stable);
assert(Boolean(matched), `稳定 60fps 行必须匹配采集正则：${stable}`);
assert(matched?.[1] === "60" && matched?.[2] === "60.0", "frames=60 fps=60.0");
assert(matched?.[3] === "16.70" && matched?.[4] === "16.70" && matched?.[5] === "16.70", "p50/p95/max 保留两位");
assert(matched?.[6] === "0" && matched?.[7] === "0", "gt16/gt33 计数为 0");

const longFrames = formatFrameSummary({
  frames: 3,
  gt16: 2,
  gt33: 1,
  max: 40,
  elapsedMs: 5_000,
  intervals: [16, 20, 40],
});
const longMatch = PERF_BODY.exec(longFrames);
assert(Boolean(longMatch), `长帧窗口行必须匹配采集正则：${longFrames}`);
assert(longMatch?.[2] === "0.6", "fps 按实际窗口时长换算");
assert(longMatch?.[6] === "2" && longMatch?.[7] === "1", "gt16/gt33 计数保留");

const empty = formatFrameSummary({
  frames: 0,
  gt16: 0,
  gt33: 0,
  max: 0,
  elapsedMs: 0,
  intervals: [],
});
assert(PERF_BODY.test(empty), `空窗口也必须可解析：${empty}`);
assert(empty.startsWith("frames=0 fps=0.0 p50=0.00 p95=0.00"), "空窗口读数为 0");

assert(percentile([1, 2, 3, 4], 0.5) === 2, "中位数取左中位");
assert(percentile([1, 2, 3, 4, 5], 0.95) === 4, "小样本 p95 取 floor((n-1)*0.95) 下标");
assert(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 0.95) === 95, "100 样本 p95=95");
assert(percentile([], 0.95) === 0, "空数组返回 0");

// 负对照：少一个字段/多一个空格都不能被采集正则接受。
assert(!PERF_BODY.test(stable.replace(" gt33=0", "")), "缺字段应被正则拒绝");
assert(!PERF_BODY.test(`${stable}  `), "尾部空格应被正则拒绝");

console.log("帧率汇总格式测试通过");
