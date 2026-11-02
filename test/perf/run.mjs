#!/usr/bin/env node
/**
 * 真机分场景性能采集（需求：docs/需求文档/2026-10-27-需求文档-渲染性能优化与动效.md）。
 *
 * 前置：`VITE_FRAME_PROBE=1 npm run tauri build -- --debug --no-bundle` 已产出带帧探针的二进制。
 * 流程：编译 AX 辅助程序 → 包装 .app（隔离 STARRIS_HOME，STARRIS_LOG_LEVEL=debug）→
 *       引导建工作区/知识库 → 逐场景驱动真实交互 → 解析 logs/starris.log 中 perfProbe 读数 →
 *       按场景时间窗聚合出 report.md / report.json。
 *
 * 运行：node test/perf/run.mjs（需辅助功能权限；不能有其他星屿实例在跑）。
 * 帧读数口径：perfProbe 每 5s 一条 `info [perf] frames=… fps=… p50=… p95=… max=… gt16=… gt33=…`。
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { NativeAX, sleep } from "../e2e/harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const STAMP = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
const RUN_DIR = path.join(ROOT, "tmp/perf", STAMP);
const HOME = path.join(RUN_DIR, "home");
const WORKSPACE = path.join(RUN_DIR, "workspace");
const HELPER_BIN = path.join(RUN_DIR, "bin/axhelper");
const HELPER_SRC = path.join(ROOT, "test/e2e/native/axhelper.swift");
const APP_LOG = path.join(RUN_DIR, "app.log");
const LOG_FILE = path.join(HOME, "logs/starris.log");
const APP_BINARY = path.join(ROOT, "src-tauri/target/debug/starris-rust");
const APP_BUNDLE = path.join(RUN_DIR, "Starris Perf.app");
const APP_EXECUTABLE = path.join(APP_BUNDLE, "Contents/MacOS/starris-perf");

for (const directory of [HOME, WORKSPACE, path.dirname(HELPER_BIN)]) {
  fs.mkdirSync(directory, { recursive: true });
}

function fail(message) {
  console.error(`\n[性能采集失败] ${message}`);
  process.exit(2);
}

const running = spawnSync("pgrep", ["-f", "target/debug/starris-rust"], { encoding: "utf8" });
if (running.status === 0 && running.stdout.trim()) {
  fail("已有星屿实例在运行，请先关闭再采集。");
}

const compiled = spawnSync("swiftc", ["-O", HELPER_SRC, "-o", HELPER_BIN], {
  encoding: "utf8",
  timeout: 120_000,
});
if (compiled.status !== 0) {
  fail(`AX 辅助程序编译失败（需要 Xcode Command Line Tools）：\n${compiled.stderr || compiled.stdout}`);
}

function prepareAppBundle() {
  const contents = path.join(APP_BUNDLE, "Contents");
  fs.mkdirSync(path.dirname(APP_EXECUTABLE), { recursive: true });
  fs.writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jh.starris</string>
<key>CFBundleName</key><string>Starris Perf</string>
<key>CFBundleDisplayName</key><string>Starris Perf</string>
<key>CFBundleExecutable</key><string>starris-perf</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`,
  );
  fs.writeFileSync(
    APP_EXECUTABLE,
    `#!/bin/zsh
# 输出日志硬上限 200MiB，避免卡死时的空转输出写满磁盘。
ulimit -f 409600
export STARRIS_HOME='${HOME}'
export STARRIS_LOG_LEVEL=debug
export STARRIS_MCP_PORT=47831
exec '${APP_BINARY}' > '${APP_LOG}' 2>&1
`,
  );
  fs.chmodSync(APP_EXECUTABLE, 0o755);
}

const ax = new NativeAX(HELPER_BIN);

/** 等待窗口出现并激活。 */
async function waitForWindow() {
  const deadline = Date.now() + 120_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const win = ax.window();
      ax.activate();
      return win;
    } catch (error) {
      lastError = error;
      if (/辅助功能权限|Accessibility|AXIsProcessTrusted/.test(error.message)) fail(error.message);
      await sleep(500);
    }
  }
  throw new Error(`等待应用窗口超时：${lastError?.message ?? ""}`);
}

async function waitForText(text, { timeout = 15_000, role, interval = 200 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const found = ax.find(text, { role });
      if (found.count > 0) return found.matches;
    } catch {
      // 轮询重试
    }
    await sleep(interval);
  }
  throw new Error(`等待文本超时：${text}`);
}

async function press(text, options = {}) {
  await waitForText(text, { timeout: options.timeout ?? 8000, role: options.role });
  ax.press(text, options);
  await sleep(options.settle ?? 250);
}

async function fillText(query, text) {
  ax.fill(query, text);
  await sleep(250);
}

// ---------- MCP 预置大数据（贴近真实规模：240 篇批量文档 + 320 段长文档） ----------

const MCP_URL = "http://127.0.0.1:47831/mcp";
let MCP_TOKEN = "";

function readMcpToken() {
  const dbPath = path.join(HOME, "db/starris.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("mcp.token");
    return typeof row?.value === "string" ? row.value : "";
  } finally {
    db.close();
  }
}

let mcpRpcId = 0;

async function mcpCall(name, args = {}) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${MCP_TOKEN}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++mcpRpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const payload = await response.json().catch(() => null);
  const text = payload?.result?.content?.[0]?.text ?? "";
  let execution;
  try {
    // tools/call 返回 AiExecution 包装：{status, data, message}
    execution = JSON.parse(text);
  } catch {
    throw new Error(`MCP ${name} 响应不可解析：${text.slice(0, 160)}`);
  }
  if (execution.status !== "ok") {
    throw new Error(`MCP ${name} 执行失败：${execution.message ?? execution.status}`);
  }
  return execution.data ?? {};
}

/** 生成 n 个段落的 markdown（标题 + 正文），供 doc_create 预置长文档。 */
function buildMarkdown(paragraphs) {
  const lines = [];
  for (let index = 1; index <= paragraphs; index += 1) {
    lines.push(`## 采集段落 ${index}`);
    lines.push("");
    lines.push("这是用于真机性能采集的正文段落，包含中英文混排 Performance profiling text 以及数字 0123456789，用于验证长文档下的鼠标跟随、输入与滚动帧率。");
    lines.push("");
  }
  return lines.join("\n");
}

/** 把 AI 协作权限临时改为 editable（写在工作区库 workspace_meta；采集用隔离目录，不改真实数据）。 */
function setAiEditable() {
  const dbPath = path.join(WORKSPACE, "db/workspace.sqlite3");
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      "INSERT INTO workspace_meta (key, value) VALUES ('ai.permissions', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(JSON.stringify({ doc: "editable", board: "editable", mindmap: "editable" }));
  } finally {
    db.close();
  }
}

async function seedLargeData() {
  MCP_TOKEN = readMcpToken();
  if (!MCP_TOKEN) fail("未在全局库读到 MCP 令牌（settings.mcp.token）");
  await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++mcpRpcId, method: "initialize", params: {} }),
  });
  const kbPayload = await mcpCall("kb_list");
  const kbId = kbPayload.knowledgeBases?.[0]?.id;
  if (!kbId) fail("未找到知识库，无法预置大数据");
  await mcpCall("doc_create", {
    knowledgeBaseId: kbId,
    title: "Perf 长文档",
    markdown: buildMarkdown(320),
  });
  for (let folderIndex = 0; folderIndex < 6; folderIndex += 1) {
    const folder = await mcpCall("node_create_folder", {
      knowledgeBaseId: kbId,
      title: `Perf 文件夹 ${folderIndex + 1}`,
    });
    for (let docIndex = 0; docIndex < 40; docIndex += 1) {
      await mcpCall("doc_create", {
        knowledgeBaseId: kbId,
        parentId: folder.nodeId,
        title: `批量文档 ${folderIndex + 1}-${docIndex + 1}`,
        markdown: buildMarkdown(24),
      });
    }
  }
  console.log("✔ MCP 预置完成：1 长文档(320段) + 6 文件夹 × 40 文档");
}

/** 启动（或重启）被测应用；种子数据写入后重启以重载文件树。 */
async function launchApp() {
  prepareAppBundle();
  const opened = spawnSync("open", ["-n", APP_BUNDLE], { encoding: "utf8" });
  if (opened.status !== 0) fail(`启动应用失败：${opened.stderr || opened.stdout}`);
  await waitForWindow();
  await sleep(2500);
}

// ---------- 场景执行包装 ----------
const timeline = [];
let failedScenarios = 0;

async function scenario(name, seconds, body) {
  const window = { name, start: Date.now(), end: 0, error: null };
  console.log(`\n▶ 场景 ${name}（约 ${seconds}s）`);
  const startedAt = Date.now();
  try {
    // 场景开始前拉回前台：长跑中窗口失去焦点/被遮挡会让 WKWebView 挂起 rAF（采集器污染）。
    try {
      ax.activate();
      await sleep(150);
    } catch {
      // 激活失败不阻断场景
    }
    await body();
  } catch (error) {
    window.error = error.message;
    failedScenarios += 1;
    console.log(`⚠ 场景 ${name} 失败：${error.message}`);
  } finally {
    const elapsed = Date.now() - startedAt;
    // 补足到目标时长，保证每个场景至少采集 seconds 秒的帧数据。
    if (elapsed < seconds * 1000) await sleep(seconds * 1000 - elapsed);
    window.end = Date.now();
    timeline.push(window);
    console.log(`■ 场景 ${name} 结束（实际 ${(elapsed / 1000).toFixed(1)}s + 补足）`);
  }
}

/** 轻量动作包装：带短等待，模拟真人节奏。 */
const act = {
  async press(text, options = {}) {
    await press(text, options);
  },
  async key(combo) {
    ax.key(combo);
    await sleep(200);
  },
  async drag(x1, y1, x2, y2) {
    ax.drag(x1, y1, x2, y2);
    await sleep(300);
  },
  async clientDrag(x1, y1, x2, y2) {
    const bounds = ax.window().bounds;
    ax.drag(bounds.X + x1, bounds.Y + y1, bounds.X + x2, bounds.Y + y2);
    await sleep(300);
  },
  async scroll(x, y, dy) {
    ax.scroll(x, y, dy);
    await sleep(200);
  },
  async clientScroll(x, y, dy) {
    const bounds = ax.window().bounds;
    ax.scroll(bounds.X + x, bounds.Y + y, dy);
    await sleep(200);
  },
  async click(x, y) {
    ax.click(x, y);
    await sleep(200);
  },
  async clientClick(x, y) {
    const bounds = ax.window().bounds;
    ax.click(bounds.X + x, bounds.Y + y);
    await sleep(200);
  },
};

async function setupWorkspace() {
  await waitForText("欢迎使用星屿", { timeout: 60_000 });
  await press("新建工作区");
  await waitForText("创建工作区");
  await sleep(400);
  let pathValue = "";
  for (let attempt = 0; attempt < 3 && pathValue !== WORKSPACE; attempt += 1) {
    await fillText("选择文件夹", WORKSPACE);
    const field = ax.find("选择文件夹", { role: "AXTextField" });
    pathValue = field.matches[0]?.value ?? "";
  }
  if (pathValue !== WORKSPACE) fail(`工作区路径填写异常：${pathValue}`);
  await fillText("名称", "Perf 工作区");
  // 创建偶发未生效（弹窗动画期点击被吞）；弹窗还在就再点一次。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await press("创建");
    try {
      await waitForText("新建内容", { timeout: 20_000 });
      return;
    } catch {
      let dialogOpen = false;
      try {
        dialogOpen = ax.find("创建工作区").count > 0;
      } catch {
        dialogOpen = false;
      }
      if (!dialogOpen) throw new Error("弹窗已关闭但主界面未就绪");
      await sleep(800);
    }
  }
  fail("创建工作区重试 3 次仍未进入主界面");
}

async function createNode(kind, title) {
  await press("新建内容");
  await waitForText("创建");
  await press(kind, { role: "AXCheckBox", settle: 200 });
  await fillText("名称", title);
  await press("创建");
  await waitForText(`${title} 操作`, { timeout: 15_000 });
  await sleep(400);
}

async function buildFixture() {
  await scenario("fixture_setup", 6, async () => {
    await createNode("文档", "Perf Doc A");
    await createNode("文档", "Perf Doc B");
    await createNode("文档", "Perf Doc C");
    await createNode("画板", "Perf Board");
    await createNode("思维导图", "Perf Mindmap");
  });
}

const ARGS = process.argv.slice(2);
const ONLY = ARGS.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((name) => name.trim())) : null;

const scenarios = [
  {
    name: "01_idle",
    seconds: 12,
    async run() {
      await sleep(3000);
    },
  },
  {
    name: "02_dialog_settings",
    seconds: 14,
    async run() {
      for (let round = 0; round < 5; round += 1) {
        await act.press("更多 ⌘J", { settle: 350 });
        await press("设置", { role: "AXMenuItem", settle: 500 });
        await waitForText("外观", { timeout: 5000 });
        await sleep(500);
        await act.key("escape");
        await sleep(500);
      }
    },
  },
  {
    name: "03_dialog_theme",
    seconds: 12,
    async run() {
      await act.press("更多 ⌘J", { settle: 350 });
      await press("设置", { role: "AXMenuItem", settle: 500 });
      await waitForText("主题", { timeout: 5000 });
      for (let round = 0; round < 4; round += 1) {
        await act.press(round % 2 === 0 ? "深色" : "浅色", { role: "AXCheckBox", settle: 700 });
      }
      await act.key("escape");
      await sleep(400);
      // 回到浅色，避免影响后续场景的视觉基线。
      await act.press("更多 ⌘J", { settle: 350 });
      await press("设置", { role: "AXMenuItem", settle: 500 });
      await waitForText("主题", { timeout: 5000 });
      await act.press("浅色", { role: "AXCheckBox", settle: 700 });
      await act.key("escape");
    },
  },
  {
    name: "04_info_float",
    seconds: 14,
    async run() {
      await act.press("Perf Doc A", { settle: 700 });
      await waitForText("文档正文", { timeout: 15_000 });
      for (let round = 0; round < 5; round += 1) {
        await act.press("打开信息面板", { settle: 700 });
        await sleep(400);
        await act.press("关闭信息面板", { settle: 500 });
        await sleep(400);
      }
    },
  },
  {
    name: "05_tab_switch",
    seconds: 16,
    async run() {
      await act.press("Perf Doc B", { settle: 700 });
      await waitForText("文档正文", { timeout: 15_000 });
      for (let round = 0; round < 8; round += 1) {
        await act.press("Perf Doc A", { settle: 450 });
        await act.press("Perf Doc B", { settle: 450 });
      }
    },
  },
  {
    name: "06_doc_typing",
    seconds: 18,
    async run() {
      await act.press("Perf Doc C", { settle: 700 });
      await waitForText("文档正文", { timeout: 15_000 });
      await act.clientClick(430, 300);
      await sleep(300);
      const paragraph =
        "渲染性能采集段落。".repeat(24) + "\n\n";
      ax.paste(paragraph);
      await sleep(600);
      for (let round = 0; round < 40; round += 1) {
        ax.key("a");
        await sleep(120);
      }
      await sleep(2500);
    },
  },
  {
    name: "07_doc_scroll",
    seconds: 12,
    async run() {
      for (let round = 0; round < 10; round += 1) {
        await act.clientScroll(430, 380, round % 2 === 0 ? -3 : 3);
      }
    },
  },
  {
    name: "08_board_canvas",
    seconds: 16,
    async run() {
      await act.press("Perf Board", { settle: 900 });
      await waitForText("组件库", { timeout: 20_000 });
      await sleep(1200);
      for (let round = 0; round < 6; round += 1) {
        const dx = 40 + round * 12;
        await act.clientDrag(400 + dx, 260, 640 + dx, 420);
      }
      for (let round = 0; round < 6; round += 1) {
        await act.clientScroll(520, 340, round % 2 === 0 ? -2 : 2);
      }
    },
  },
  {
    name: "09_mindmap",
    seconds: 18,
    async run() {
      await act.press("Perf Mindmap", { settle: 900 });
      await waitForText("中心主题", { timeout: 20_000 });
      for (const topic of ["采集主题一", "采集主题二", "采集主题三"]) {
        await act.press("中心主题", { settle: 300 });
        await act.key("tab");
        ax.paste(topic);
        await sleep(250);
        await act.key("return");
        await waitForText(topic, { timeout: 10_000 });
      }
      await act.press("大纲视图", { settle: 600 });
      await act.press("关闭大纲", { settle: 500 });
      await act.press("新建自由主题", { settle: 700 });
    },
  },
  {
    name: "10_sidebar_toggle",
    seconds: 12,
    async run() {
      for (let round = 0; round < 6; round += 1) {
        await act.key("cmd+\\");
        await sleep(450);
      }
    },
  },
  {
    name: "11_bigdoc_hover",
    seconds: 14,
    async run() {
      await act.press("Perf 长文档", { settle: 900 });
      await waitForText("文档正文", { timeout: 20_000 });
      await sleep(1500);
      for (let round = 0; round < 4; round += 1) {
        for (let y = 240; y <= 620; y += 40) {
          ax.hover(400, y);
          await sleep(60);
        }
      }
    },
  },
  {
    name: "12_bigdoc_typing",
    seconds: 16,
    async run() {
      await act.clientClick(430, 300);
      await sleep(300);
      for (let round = 0; round < 60; round += 1) {
        if (round % 20 === 0) {
          // 长按键盘期间定期拉回前台，避免焦点漂移导致 rAF 挂起污染读数。
          try {
            ax.activate();
          } catch {
            // 忽略
          }
        }
        ax.key("a");
        await sleep(100);
      }
      await sleep(2500);
    },
  },
  {
    name: "13_bigdoc_scroll",
    seconds: 12,
    async run() {
      for (let round = 0; round < 12; round += 1) {
        await act.clientScroll(430, 380, round % 2 === 0 ? -4 : 4);
      }
    },
  },
  {
    name: "14_bigtree_sidebar",
    seconds: 12,
    async run() {
      await act.press("Perf 文件夹 1", { settle: 400 });
      try {
        await waitForText("批量文档 1-1", { timeout: 10_000 });
      } catch {
        // 文件夹可能默认已展开或点击行为不同；侧栏切换仍然有效。
        console.log("  （未确认子文档展开，继续侧栏切换）");
      }
      for (let round = 0; round < 6; round += 1) {
        await act.key("cmd+\\");
        await sleep(450);
      }
    },
  },
];

async function stopApp() {
  let appPid = null;
  try {
    appPid = ax.window().pid;
  } catch {
    appPid = null;
  }
  if (appPid) {
    try {
      process.kill(appPid, "SIGTERM");
    } catch {
      // 已退出
    }
  } else {
    spawnSync("pkill", ["-f", APP_BINARY]);
  }
  await sleep(1500);
}

// ---------- 日志解析与聚合 ----------

const PERF_LINE =
  /^(?<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}) info \[perf\] (?<body>.+)$/;

function parsePerfLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const entries = [];
  for (const line of fs.readFileSync(LOG_FILE, "utf8").split("\n")) {
    const match = PERF_LINE.exec(line.trim());
    if (!match) continue;
    const ts = Date.parse(match.groups.ts);
    if (Number.isNaN(ts)) continue;
    const body = match.groups.body;
    if (body.startsWith("long_frames")) continue;
    const value = (key) => {
      const found = new RegExp(`${key}=([0-9.]+)`).exec(body);
      return found ? Number.parseFloat(found[1]) : 0;
    };
    entries.push({
      ts,
      frames: value("frames"),
      fps: value("fps"),
      p50: value("p50"),
      p95: value("p95"),
      max: value("max"),
      gt16: value("gt16"),
      gt33: value("gt33"),
    });
  }
  return entries;
}

function aggregate() {
  const entries = parsePerfLog();
  const results = timeline.map((window) => {
    // 窗口起点回退 5s：汇总行覆盖的是"过去 5s"，可能落在场景开始之前。
    const from = window.start - 5100;
    const rows = entries.filter((entry) => entry.ts >= from && entry.ts <= window.end + 1000);
    const frames = rows.reduce((sum, row) => sum + row.frames, 0);
    const gt16 = rows.reduce((sum, row) => sum + row.gt16, 0);
    const gt33 = rows.reduce((sum, row) => sum + row.gt33, 0);
    const coveredS = rows.length * 5; // 每个采样窗覆盖 5s
    return {
      scenario: window.name,
      windows: rows.length,
      frames,
      fps: coveredS ? Number((frames / coveredS).toFixed(1)) : null,
      p50Max: rows.length ? Math.max(...rows.map((row) => row.p50)) : null,
      p95Max: rows.length ? Math.max(...rows.map((row) => row.p95)) : null,
      maxFrame: rows.length ? Math.max(...rows.map((row) => row.max)) : null,
      gt16,
      gt33,
      gt16Ratio: frames ? Number(((gt16 / frames) * 100).toFixed(2)) : null,
    };
  });
  return { results, entriesCount: entries.length };
}

function renderReport({ results, entriesCount }) {
  const head = [
    "| 场景 | 采样窗 | 帧数 | fps | p50峰值(ms) | p95峰值(ms) | 最大帧(ms) | >16.7ms帧 | >33ms帧 | >16.7占比 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const body = results.map((row) =>
    `| ${row.scenario} | ${row.windows} | ${row.frames} | ${row.fps} | ${row.p50Max ?? "—"} | ${row.p95Max ?? "—"} | ${row.maxFrame ?? "—"} | ${row.gt16} | ${row.gt33} | ${row.gt16Ratio ?? "—"}% |`,
  );
  return [
    "# 真机性能基线采集报告",
    "",
    "- 运行目录：tmp/perf/" + STAMP + "",
    "- 二进制：src-tauri/target/debug/starris-rust（生产前端，tauri build --debug --no-bundle）",
    "- 探针读数条数：" + entriesCount + "",
    "- 平台事实：ProMotion 屏 + 低电量关闭下 WKWebView 实测 60fps 上限（空闲 p50=17ms），120fps 在当前 Tauri 栈不可达；验收口径为 60fps 稳定零掉帧。",
    "- 时间：" + new Date().toISOString() + "",
    "",
    ...head,
    ...body,
    "",
    "> 口径：p50/p95/max 取该场景各 5s 窗口的峰值；fps=总帧数/场景时长。首次进入场景的窗口可能混入挂载成本。",
  ].join("\n");
}

// ---------- 主流程 ----------

const viteChild = null; // 生产前端内嵌 dist，不需要 Vite。

try {
  await launchApp();
  await setupWorkspace();
  setAiEditable();
  await seedLargeData();
  // 种子写入不经过前端；重启让 bootstrap 重新拉取节点树。
  await stopApp();
  await launchApp();
  await buildFixture();
  for (const item of scenarios) {
    if (ONLY_SET && !ONLY_SET.has(item.name)) continue;
    await scenario(item.name, item.seconds, item.run);
  }
} catch (error) {
  failedScenarios += 1;
  console.log(`⚠ 采集主流程异常：${error.message}`);
} finally {
  await stopApp();
  const summary = aggregate();
  fs.writeFileSync(path.join(RUN_DIR, "report.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(RUN_DIR, "report.md"), renderReport(summary));
  fs.writeFileSync(path.join(RUN_DIR, "timeline.json"), JSON.stringify(timeline, null, 2));
  console.log(`\n✔ 采集完成：${RUN_DIR}`);
  console.log(renderReport(summary));
  if (failedScenarios > 0) process.exitCode = 3;
}
