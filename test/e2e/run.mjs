#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cases from "./cases/index.mjs";
import { NativeAX, TestContext, sleep } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const ARGS = process.argv.slice(2);
const FILTER_RAW = ARGS.find((arg) => arg.startsWith("--case="))?.slice("--case=".length);
const FILTERS = (FILTER_RAW ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
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

/**
 * 关闭上一用例可能遗留的系统面板。
 *
 * 2026-10-26 现场：文件面板的「前往文件夹」sheet 未被确认时，模态循环让 AX 整树为空。
 * 2026-10-28 现场：`30-doc` 导出失败后系统保存面板常驻，后续 19 个用例全部因 AX 不可用而连环失败。
 * 判定：
 * - AX 树可读且出现「取消/Cancel」→ 按 Escape；
 * - AX 树不可读或为空（原生 sheet 模态的典型表现）→ 也按一次 Escape（这是唯一能解除模态的手段）；
 * - AX 树正常且无 Cancel → 不动，避免把 Escape 送进下一个用例刚打开的弹窗。
 */
async function dismissStrayPanels(context) {
  let tree = null;
  try {
    tree = context.ax._call(["tree"]);
  } catch {
    tree = null;
  }
  let empty = (tree?.count ?? 0) === 0;
  // 空树要复核一次再按键：AX 瞬时重建也会读到 0，盲按 Escape 可能关掉下一个用例刚打开的浮层。
  if (empty) {
    await sleep(250);
    try {
      empty = (context.ax._call(["tree"]).count ?? 0) === 0;
    } catch {
      empty = true;
    }
  }
  // 整树读不到（count=0）、出现「取消/Cancel」或出现对话框右上角「关闭」都按模态残留处理：
  // 2026-10-28 现场发现旧版 tree 查询用空串匹配，Swift 里恒为 false，导致本函数从未真正兜底。
  // 同日第二现场：`21-import-mindmap` 断言失败时弹窗留着，页脚按钮已从「取消」变成「完成」，
  // 只看「取消」判不出残留，后面 27 个用例全部找不到侧栏。
  // 同日第三现场：AI 待审确认弹窗（确认执行/拒绝/稍后处理）也是模态，断言失败会同样卡住后续用例。
  const hasSheet = (tree?.matches ?? []).some((match) => match.role === "AXSheet");
  const stray =
    empty || hasSheet || /取消|Cancel|"关闭"|Close|确认执行|稍后处理/.test(JSON.stringify(tree));
  if (!stray) return;
  try {
    context.ax.key("escape");
    await sleep(300);
  } catch {
    // 连按键都无法送达时放弃，交给后续用例的等待超时暴露问题。
  }
  if (!hasSheet) return;
  // 原生文件面板可能叠着「前往文件夹」sheet：第一下只关掉子 sheet，再补一下取消整个保存面板。
  try {
    const after = context.ax._call(["tree"]);
    const stillSheet = (after?.matches ?? []).some((match) => match.role === "AXSheet");
    if (stillSheet) {
      context.ax.key("escape");
      await sleep(300);
    }
  } catch {
    // 树读不到时已经按过一次 Escape，交给后续用例。
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
# 输出日志硬上限 200MiB：应用卡死时空转日志也写不炸磁盘（超出由 SIGXFSZ 终止）。
ulimit -f 409600
export STARRIS_HOME=${shellQuote(HOME)}
export STARRIS_LOG_LEVEL=info
export STARRIS_MCP_PORT=47822
exec ${shellQuote(APP_BINARY)} > ${shellQuote(APP_LOG)} 2>&1
`,
  );
  fs.chmodSync(APP_EXECUTABLE, 0o755);
}

/** 源码里最新的修改时间；用于判断现有 debug 二进制是否还新鲜。 */
function newestSourceMtime(targets) {
  let newest = 0;
  const visit = (target) => {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs);
      return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "target" || entry.name.startsWith(".")) continue;
      visit(path.join(target, entry.name));
    }
  };
  for (const target of targets) {
    if (fs.existsSync(target)) visit(target);
  }
  return newest;
}

/**
 * 是否需要重新构建。
 *
 * 以前每轮 e2e 都跑一次全量 `tauri build --debug`：debug 档没有 debug info 限制，
 * 反复全量重建会把 `src-tauri/target` 单调撑大（2026-10-29 曾写满磁盘）。
 * 现在只有源码比二进制新才重编；`E2E_SKIP_BUILD=1` 可强制跳过。
 */
function needsBuild() {
  if (process.env.E2E_SKIP_BUILD === "1") return false;
  if (!fs.existsSync(APP_BINARY)) return true;
  const binaryTime = fs.statSync(APP_BINARY).mtimeMs;
  const newestSource = newestSourceMtime([
    path.join(ROOT, "src"),
    path.join(ROOT, "src-tauri/src"),
    path.join(ROOT, "index.html"),
  ]);
  return newestSource > binaryTime;
}

async function startApp() {
  // 黑盒测试跑「生产前端」的内嵌构建，不挂 Vite dev server。
  // 2026-10-28 真机取证：用例把导出/附件写进项目内 tmp/ 时，Vite 会对这些文件发 HMR/整页重载，
  // 运行中的标签页与弹窗状态被清零（26-mindmap 在导出前丢掉了导图标签页）；内嵌构建没有这条通道。
  if (needsBuild()) {
    const build = spawnSync("npm", ["run", "tauri", "build", "--", "--debug", "--no-bundle"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 600_000,
    });
    if (build.status !== 0) {
      failSetup(`tauri build 失败：\n${build.stderr || build.stdout}`);
    }
  } else {
    console.log("⏭ 跳过构建：debug 二进制已比源码新");
  }
  prepareAppBundle();
  const opened = spawnSync("open", ["-n", APP_BUNDLE], { encoding: "utf8" });
  if (opened.status !== 0) {
    failSetup(`启动测试应用失败：\n${opened.stderr || opened.stdout}`);
  }
  return null;
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

/**
 * 应用进程在套件中途消失时把它拉回来。
 *
 * 真机取证：`20261028T093733` 从 27 号用例起 22 个用例全报「starris-rust 未运行」，
 * 一个中途退出会把后半套全部变成无意义失败。这里按测试二进制路径判活（pgrep，
 * 不看 AX 报错文案），确认没进程了就重新 `open -n` 同一个临时 bundle，
 * 等窗口与首屏文本回来再继续；返回是否发生过重启。
 */
async function ensureAlive(ax) {
  const alive = spawnSync("pgrep", ["-f", APP_BINARY], { encoding: "utf8" });
  if (alive.status === 0) return false;
  process.stdout.write("[重启] 应用进程已退出，重新拉起后继续跑剩余用例\n");
  const opened = spawnSync("open", ["-n", APP_BUNDLE], { encoding: "utf8" });
  if (opened.status !== 0) {
    failSetup(`重启测试应用失败：\n${opened.stderr || opened.stdout}`);
  }
  await waitForWindow(ax);
  await waitForFirstScreen(ax);
  return true;
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
  if (child) {
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

const selected = cases.filter((item) => {
  if (FILTERS.length === 0) return true;
  const haystack = `${item.id} ${item.title} ${item.area}`.toLowerCase();
  return FILTERS.some((filter) => haystack.includes(filter.toLowerCase()));
});
if (selected.length === 0) failSetup(`没有匹配 --case=${FILTER_RAW} 的用例`);

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
      if (await ensureAlive(ax)) {
        result.notes.push("进入本用例前应用进程已不存在，测试脚本重新拉起了应用");
      }
      await context.activate();
      await dismissStrayPanels(context);
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
  filter: FILTER_RAW ?? null,
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
