#!/usr/bin/env node
/**
 * 交互响应报告：解析 app 日志里的 perf.interaction 点击读数。
 *
 * 前置：用探针构建启动应用（VITE_INTERACTION_PROBE=1）。
 * 用法：node test/perf/interaction-report.mjs [运行目录或 latest]
 * 输出：终端 markdown 摘要 + <运行目录>/interaction-report.md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ARG = process.argv[2] ?? "latest";
const RUN_DIR = path.isAbsolute(ARG) ? ARG : path.join(ROOT, "tmp/e2e", ARG);

function findLog(directory) {
  const candidates = [
    path.join(directory, "home/logs/starris.log"),
    path.join(directory, "logs/starris.log"),
    path.join(directory, "app.log"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

const CLICK = /\[perf\.interaction\] click label="(.*)" micro=([\d.]+)ms frame=([\d.]+)ms/;
const LONG = /\[perf\.interaction\] longtask=([\d.]+)ms/;

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

const logPath = findLog(RUN_DIR);
if (!logPath) {
  console.error(`未找到日志：${RUN_DIR}/home/logs/starris.log`);
  process.exit(2);
}

const byLabel = new Map();
const microAll = [];
const frameAll = [];
const nativeSamples = [];
const longTasks = [];
// 原生文件面板打开期间 WebKit 不产生常规帧，等待时长会污染按钮延迟；单列。
const NATIVE_PANEL_LABELS = new Set([
  "选择附件",
  "选择文件夹",
  "选择文件",
  "选择文件可多选",
  "选择图片",
  "导入组件库",
  "PNG 图片",
  "SVG 矢量图",
  "Excalidraw 文件",
  "下载",
  "导出附件",
]);
for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
  const click = CLICK.exec(line);
  if (click) {
    const [, label, micro, frame] = click;
    const entry = { micro: Number(micro), frame: Number(frame) };
    if (NATIVE_PANEL_LABELS.has(label)) {
      nativeSamples.push({ label, frame: entry.frame });
      continue;
    }
    microAll.push(entry.micro);
    frameAll.push(entry.frame);
    const list = byLabel.get(label) ?? [];
    list.push(entry);
    byLabel.set(label, list);
    continue;
  }
  const longTask = LONG.exec(line);
  if (longTask) longTasks.push(Number(longTask[1]));
}

if (microAll.length === 0) {
  console.error("日志里没有 perf.interaction 读数：请用 VITE_INTERACTION_PROBE=1 构建后再采集。");
  process.exit(2);
}

const summary = [...byLabel.entries()]
  .map(([label, entries]) => ({
    label,
    count: entries.length,
    microP95: percentile(entries.map((entry) => entry.micro), 0.95),
    frameP50: percentile(entries.map((entry) => entry.frame), 0.5),
    frameP95: percentile(entries.map((entry) => entry.frame), 0.95),
    frameMax: Math.max(...entries.map((entry) => entry.frame)),
  }))
  .sort((left, right) => right.frameP95 - left.frameP95);

const lines = [
  "# 交互响应报告",
  "",
  `- 日志：\`${logPath}\``,
  `- App 按钮样本：${microAll.length}（已剔除原生文件面板）`,
  `- 原生文件面板点击：${nativeSamples.length}（面板关闭前不产生常规帧，不计入 App 响应）`,
  "",
  "| 指标 | p50 | p95 | max |",
  "| --- | ---: | ---: | ---: |",
  `| App 按钮：到下一可绘制帧 frame（60Hz 下限约 16.7ms） | ${percentile(frameAll, 0.5).toFixed(2)} ms | ${percentile(frameAll, 0.95).toFixed(2)} ms | ${Math.max(...frameAll).toFixed(2)} ms |`,
  `| 同步派发 micro（React 提交可能延后，通常≈0） | ${percentile(microAll, 0.5).toFixed(2)} ms | ${percentile(microAll, 0.95).toFixed(2)} ms | ${Math.max(...microAll).toFixed(2)} ms |`,
  "",
  `- 长任务（≥50ms）：${longTasks.length} 次${longTasks.length ? `，最长 ${Math.max(...longTasks).toFixed(1)} ms` : ""}`,
  "",
  "## 原生文件面板（不计入 App 按钮）",
  "",
  "| 目标 | 次数 | frame p50 | frame max |",
  "| --- | ---: | ---: | ---: |",
  ...[...nativeSamples.reduce((map, item) => {
    const list = map.get(item.label) ?? [];
    list.push(item.frame);
    map.set(item.label, list);
    return map;
  }, new Map())].map(
    ([label, frames]) =>
      `| ${label} | ${frames.length} | ${percentile(frames, 0.5).toFixed(0)} ms | ${Math.max(...frames).toFixed(0)} ms |`,
  ),
  "",
  "> micro≈0 表示点击处理函数本身只做了入队；React 19 的提交在后续任务完成，因此以 frame 作为用户可见响应的主口径。",
  "",
  "## 最慢的点击目标（按 frame p95）",
  "",
  "| 目标 | 次数 | frame p50 | frame p95 | frame max | micro p95 |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...summary
    .slice(0, 15)
    .map(
      (item) =>
        `| ${item.label.replace(/\|/g, "\\|")} | ${item.count} | ${item.frameP50.toFixed(2)} ms | ${item.frameP95.toFixed(2)} ms | ${item.frameMax.toFixed(2)} ms | ${item.microP95.toFixed(2)} ms |`,
    ),
  "",
];

const report = lines.join("\n");
const reportPath = path.join(RUN_DIR, "interaction-report.md");
fs.writeFileSync(reportPath, `${report}\n`);
console.log(report);
console.log(`\n已写入 ${reportPath}`);
