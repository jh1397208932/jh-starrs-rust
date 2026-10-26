#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cases from "./cases/index.mjs";
import { NativeAX, TestContext, sleep } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ARGS = process.argv.slice(2);
const FILTER = ARGS.find((arg) => arg.startsWith("--case="))?.slice("--case=".length);
const KEEP = ARGS.includes("--keep");
const CASE_TIMEOUT_MS = 180_000;
const APP_START_TIMEOUT_MS = 180_000;

const STAMP = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\..+/, "");
const RUN_DIR = path.join(ROOT, "tmp/e2e", STAMP);
const HOME = path.join(RUN_DIR, "home");
const WORKSPACE = path.join(RUN_DIR, "workspace");
const SCREENSHOTS = path.join(RUN_DIR, "screenshots");
const HELPER_BIN = path.join(RUN_DIR, "bin/axhelper");
const HELPER_SRC = path.join(ROOT, "test/e2e/native/axhelper.swift");
const APP_LOG = path.join(RUN_DIR, "app.log");
const REPORT_JSON = path.join(RUN_DIR, "report.json");
const REPORT_MD = path.join(RUN_DIR, "report.md");

for (const directory of [HOME, WORKSPACE, SCREENSHOTS, path.dirname(HELPER_BIN)]) {
  fs.mkdirSync(directory, { recursive: true });
}

function failSetup(message) {
  console.error(`\n[测试启动失败] ${message}\n`);
  process.exit(2);
}

function noOtherApp() {
  const running = spawnSync("pgrep", ["-f", "target/debug/starris-rust"], { encoding: "utf8" });
  if (running.status === 0 && running.stdout.trim()) {
    failSetup(
      "已有一个星屿实例在运行。黑盒测试固定使用同一窗口/AX 树，请先关闭现有实例再执行 pnpm run test。",
    );
  }
}

function compileHelper() {
  const result = spawnSync(
    "swiftc",
    ["-O", HELPER_SRC, "-o", HELPER_BIN],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (result.status !== 0) {
    failSetup(
      `AX 辅助程序编译失败（需要 Xcode Command Line Tools）：\n${result.stderr || result.stdout}`,
    );
  }
}

const APP_BUNDLE = path.join(RUN_DIR, "Starris E2E.app");
const APP_EXECUTABLE = path.join(APP_BUNDLE, "Contents/MacOS/starris-e2e");
const APP_BINARY = path.join(ROOT, "src-tauri/target/debug/starris-rust");

/** shell 单引号转义；路径只在本机测试目录内使用。 */
function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * macOS 裸二进制没有 bundle，无法被 NSRunningApplication 激活，AX 树会为空。
 * 测试时用临时 .app 包装启动，产品构建方式不受影响。
 */
function prepareAppBundle() {
  const contents = path.join(APP_BUNDLE, "Contents");
  fs.mkdirSync(path.dirname(APP_EXECUTABLE), { recursive: true });
  fs.writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.jh.starris</string>
<key>CFBundleName</key><string>Starris E2E</string>
<key>CFBundleDisplayName</key><string>Starris E2E</string>
<key>CFBundleExecutable</key><string>starris-e2e</string>
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
export STARRIS_HOME=${shellQuote(HOME)}
export STARRIS_LOG_LEVEL=info
exec ${shellQuote(APP_BINARY)} >> ${shellQuote(APP_LOG)} 2>&1
`,
  );
  fs.chmodSync(APP_EXECUTABLE, 0o755);
}

async function waitForVite() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost:1420/");
      if (response.ok) return;
    } catch {
      // 继续等待
    }
    await sleep(300);
  }
  throw new Error("Vite 未在 60s 内启动");
}

async function startApp() {
  const build = spawnSync(
    "cargo",
    ["build", "--manifest-path", "src-tauri/Cargo.toml"],
    { cwd: ROOT, encoding: "utf8", timeout: 180_000 },
  );
  if (build.status !== 0) {
    failSetup(`cargo build 失败：\n${build.stderr || build.stdout}`);
  }
  const viteLogPath = path.join(RUN_DIR, "vite.log");
  const viteLog = fs.openSync(viteLogPath, "w");
  const child = spawn("npm", ["run", "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", viteLog, viteLog],
  });
  child.on("error", (error) => {
    console.error(`[测试启动失败] 无法启动 Vite：${error.message}`);
  });
  await waitForVite();
  prepareAppBundle();
  const opened = spawnSync("open", ["-n", APP_BUNDLE], { encoding: "utf8" });
  if (opened.status !== 0) {
    failSetup(`启动测试应用失败：\n${opened.stderr || opened.stdout}`);
  }
  return child;
}

async function waitForWindow(ax) {
  const deadline = Date.now() + APP_START_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const window = ax.window();
      ax.activate();
      return window;
    } catch (error) {
      lastError = error;
      if (/辅助功能权限|Accessibility|AXIsProcessTrusted/.test(error.message)) {
        failSetup(error.message);
      }
      await sleep(500);
    }
  }
  throw new Error(
    `等待应用窗口超时（${Math.round(APP_START_TIMEOUT_MS / 1000)}s）。应用日志：${path.relative(ROOT, APP_LOG)}\n${lastError?.message ?? ""}`,
  );
}

async function waitForFirstScreen(ax) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const text of ["新建工作区", "更多"]) {
      try {
        if (ax.find(text).count > 0) return text;
      } catch {
        // 继续等待
      }
    }
    await sleep(300);
  }
  throw new Error("应用窗口存在，但未找到引导页或主界面文本");
}

function stopApp(child, ax) {
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
    // 应用窗口未建立时按测试二进制兜底；测试前已检查无其他实例。
    spawnSync("pkill", ["-f", APP_BINARY]);
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // 进程组已退出
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // 已退出
  }
  return appPid;
}

function runWithTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms / 1000}s）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function relative(target) {
  return path.relative(ROOT, target);
}

function renderReport(results, meta) {
  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.length - passed;
  const lines = [
    "# 星屿黑盒全量功能测试报告",
    "",
    `- 运行时间：${meta.startedAt}`,
    `- 运行目录：\`${relative(RUN_DIR)}\``,
    `- 测试工作区：\`${WORKSPACE}\``,
    `- 应用日志：\`${relative(APP_LOG)}\``,
    `- 用例：${results.length}，通过：${passed}，失败：${failed}`,
    "",
    "## 结果总览",
    "",
    "| 用例 | 区域 | 结果 | 用时 | 点击 | 按键 | 输入 | 对话框 | 截图 |",
    "|---|---|---|---|---:|---:|---:|---:|---:|",
  ];
  for (const result of results) {
    lines.push(
      `| ${result.title} | ${result.area} | **${result.status}** | ${(result.durationMs / 1000).toFixed(1)}s | ${result.metrics.clicks} | ${result.metrics.keys} | ${result.metrics.fills} | ${result.metrics.dialogs} | ${result.screenshots.length} |`,
    );
  }
  lines.push("", "## 用例详情", "");
  for (const result of results) {
    lines.push(`### ${result.title}`, "");
    lines.push(`- 结果：**${result.status}**`);
    lines.push(`- 区域：${result.area}`);
    if (result.error) lines.push(`- 失败原因：\`${result.error.replace(/\n/g, " ")}\``);
    if (result.screenshots.length > 0) {
      lines.push(`- 截图：${result.screenshots.map((item) => `\`${relative(item)}\``).join("、")}`);
    }
    lines.push("", "| 步骤 | UI 位置 | 点击 | 弹窗 | 说明 |", "|---|---|---:|---:|---|");
    for (const step of result.steps ?? []) {
      lines.push(
        `| ${step.action} | ${step.ui} | ${step.clicks ?? 0} | ${step.dialogs ?? 0} | ${step.note ?? ""} |`,
      );
    }
    lines.push("", "**合理性评估**", "");
    lines.push(result.complexity?.assessment ?? "未提供。");
    lines.push(
      "",
      `实际动作计数：点击 ${result.metrics.clicks}、AX 按下 ${result.metrics.presses}、按键 ${result.metrics.keys}、输入 ${result.metrics.fills}、系统对话框 ${result.metrics.dialogs}。`,
      "",
    );
    if (result.notes.length > 0) {
      lines.push("实施备注：", "");
      for (const note of result.notes) lines.push(`- ${note}`);
      lines.push("");
    }
    if (result.findings.length > 0) {
      lines.push("发现与建议：", "");
      for (const finding of result.findings) {
        lines.push(`- **[${finding.severity}] ${finding.title}**：${finding.detail}`);
      }
      lines.push("");
    }
  }
  lines.push(
    "",
    "## 说明",
    "",
    "- 本报告只记录实际执行结果；失败用例不会被标记为通过。",
    "- 动作计数来自原生 AX/CGEvent 辅助程序；系统保存/打开面板计入对话框。",
    "- `tmp/` 为本地测试产物，不进入版本库。",
    "",
  );
  fs.writeFileSync(REPORT_MD, lines.join("\n"));
  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify({ meta, results }, null, 2),
  );
  return { passed, failed };
}

const selected = cases.filter((item) =>
  FILTER ? `${item.id} ${item.title} ${item.area}`.toLowerCase().includes(FILTER.toLowerCase()) : true,
);
if (selected.length === 0) failSetup(`没有匹配 --case=${FILTER} 的用例`);

noOtherApp();
compileHelper();

const ax = new NativeAX(HELPER_BIN);
const child = await startApp();
const startedAt = new Date().toISOString();
const results = [];
const shared = {};

try {
  await waitForWindow(ax);
  await waitForFirstScreen(ax);
  for (const caseMeta of selected) {
    const context = new TestContext({
      ax,
      caseMeta,
      workspacePath: WORKSPACE,
      homePath: HOME,
      fixturesDir: path.join(ROOT, "test/fixtures/files"),
      screenshotDir: SCREENSHOTS,
      reportDir: RUN_DIR,
      shared,
    });
    const started = Date.now();
    const result = {
      id: caseMeta.id,
      title: caseMeta.title,
      area: caseMeta.area,
      steps: caseMeta.steps,
      complexity: caseMeta.complexity,
      status: "PASS",
      durationMs: 0,
      metrics: context.metrics,
      screenshots: [],
      notes: context.notes,
      findings: context.findings,
      error: null,
    };
    process.stdout.write(`\n[RUN] ${caseMeta.id} ${caseMeta.title}\n`);
    try {
      await context.activate();
      await runWithTimeout(caseMeta.run(context), CASE_TIMEOUT_MS, caseMeta.title);
      console.log(`  PASS ${caseMeta.id}`);
    } catch (error) {
      result.status = "FAIL";
      result.error = error?.stack ?? String(error);
      console.log(`  FAIL ${caseMeta.id}: ${error?.message ?? error}`);
      for (const [name, action] of [
        ["failure-screen", () => context.screenshot(`failure-${caseMeta.id}`)],
        [
          "failure-ax-tree",
          () => {
            const tree = ax._call(["tree"]);
            const target = path.join(RUN_DIR, `failure-${caseMeta.id}-ax.json`);
            fs.writeFileSync(target, JSON.stringify(tree, null, 2));
            return target;
          },
        ],
      ]) {
        try {
          const file = await action();
          if (file) result.screenshots.push(file);
        } catch (captureError) {
          console.log(`  ${name} 采集失败：${captureError.message}`);
        }
      }
    } finally {
      result.durationMs = Date.now() - started;
      result.notes = context.notes;
      result.findings = context.findings;
      result.metrics = context.metrics;
      results.push(result);
    }
  }
} finally {
  if (!KEEP) {
    stopApp(child, ax);
    await sleep(1200);
  } else {
    console.log(`\n[keep] 应用保留运行，工作区：${WORKSPACE}`);
  }
}

const meta = {
  startedAt,
  finishedAt: new Date().toISOString(),
  runDir: RUN_DIR,
  workspace: WORKSPACE,
  appLog: APP_LOG,
  helper: HELPER_BIN,
  filter: FILTER ?? null,
  keptRunning: KEEP,
};
const summary = renderReport(results, meta);
const latest = path.join(ROOT, "tmp/e2e/latest");
try {
  fs.rmSync(latest, { recursive: true, force: true });
  fs.symlinkSync(RUN_DIR, latest, "dir");
} catch {
  // 报告仍写入唯一目录，latest 只是便捷入口。
}

console.log(
  `\n用例 ${results.length}，通过 ${summary.passed}，失败 ${summary.failed}\n报告：${relative(REPORT_MD)}\n`,
);
process.exit(summary.failed === 0 ? 0 : 1);
