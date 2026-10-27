import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Node 侧延迟；仅供等待原生 UI/动画，不用于掩盖竞态。 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 原生辅助程序薄封装：每次调用一个进程，参数用 base64 传递。
 * 失败会抛出包含 stderr 的错误，测试用例无需解析原生错误码。
 */
export class NativeAX {
  constructor(binPath) {
    this.binPath = binPath;
    this._window = null;
  }

  _call(args, { allowMissing = false } = {}) {
    const result = spawnSync(this.binPath, args, { encoding: "utf8", timeout: 25_000 });
    const stdout = result.stdout?.trim() ?? "";
    let payload;
    try {
      payload = stdout ? JSON.parse(stdout) : null;
    } catch {
      payload = null;
    }
    if (result.error) throw result.error;
    if (!payload || payload.ok !== true) {
      const detail = payload?.error ?? result.stderr?.trim() ?? `axhelper exit ${result.status}`;
      if (allowMissing && /找不到|未运行/.test(detail)) return null;
      throw new Error(detail);
    }
    return payload;
  }

  b64(text) {
    return Buffer.from(text, "utf8").toString("base64");
  }

  window() {
    this._window = this._call(["window"]);
    return this._window;
  }

  activate() {
    return this._call(["activate"]);
  }

  find(query, { role } = {}) {
    const args = ["find", this.b64(query)];
    if (role) args.push("--role", role);
    return this._call(args);
  }

  press(query, { role } = {}) {
    const args = ["press", this.b64(query)];
    if (role) args.push("--role", role);
    return this._call(args);
  }

  fill(query, text) {
    return this._call(["fill", this.b64(query), this.b64(text)]);
  }

  click(x, y) {
    return this._call(["click", String(x), String(y)]);
  }

  rightClick(x, y) {
    return this._call(["rightclick", String(x), String(y)]);
  }

  doubleClick(x, y) {
    return this._call(["doubleclick", String(x), String(y)]);
  }

  scroll(x, y, dy) {
    return this._call(["scroll", String(x), String(y), String(dy)]);
  }

  hover(x, y) {
    return this._call(["hover", String(x), String(y)]);
  }

  drag(x1, y1, x2, y2) {
    return this._call(["drag", String(x1), String(y1), String(x2), String(y2)]);
  }

  key(combo) {
    return this._call(["key", combo]);
  }

  paste(text) {
    return this._call(["paste", this.b64(text)]);
  }
}

/** 单个用例的上下文：动作、等待、断言、截图与数据核对。 */
export class TestContext {
  constructor({ ax, caseMeta, workspacePath, homePath, fixturesDir, screenshotDir, reportDir, shared }) {
    this.ax = ax;
    this.caseMeta = caseMeta;
    this.workspacePath = workspacePath;
    this.homePath = homePath;
    this.fixturesDir = fixturesDir;
    this.screenshotDir = screenshotDir;
    this.reportDir = reportDir;
    this.shared = shared ?? {};
    this.metrics = { clicks: 0, presses: 0, keys: 0, fills: 0, dialogs: 0, screenshots: 0 };
    this.notes = [];
    this.findings = [];
  }

  window() {
    return this.ax.window();
  }

  async activate() {
    this.ax.activate();
    await sleep(120);
  }

  async find(text, options) {
    return this.ax.find(text, options);
  }

  async waitForText(text, { timeout = 15_000, role, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = this.ax.find(text, { role });
        if (last.count > 0) return last.matches;
      } catch {
        last = null;
      }
      await sleep(interval);
    }
    throw new Error(
      `等待文本超时：${text}${last ? `（命中 ${last.count}）` : ""}`,
    );
  }

  async waitForGone(text, { timeout = 10_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const found = this.ax.find(text);
        if (found.count === 0) return;
      } catch {
        return;
      }
      await sleep(interval);
    }
    throw new Error(`元素未消失：${text}`);
  }

  async expectText(text, options = {}) {
    const { timeout = 15_000, role, message } =
      typeof options === "number" ? { timeout: options } : options;
    try {
      return await this.waitForText(text, { timeout, role });
    } catch {
      throw new Error(message ?? `等待文本超时：${text}`);
    }
  }

  async expectNoText(text) {
    await this.waitForGone(text);
  }

  async expectGone(text, options = {}) {
    await this.waitForGone(text, options);
  }

  async press(text, options = {}) {
    await this.waitForText(text, { timeout: options.timeout ?? 8000, role: options.role });
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.ax.press(text, options);
        break;
      } catch (error) {
        // 应用激活/窗口切换的瞬间 AX 可能短暂找不到窗口；重试同一目标。
        if (!/找不到应用窗口/.test(error.message) || attempt >= 5) throw error;
        await sleep(300);
        try {
          this.ax.activate();
        } catch {
          // 下一次重试仍会重新查找窗口
        }
      }
    }
    this.metrics.presses += 1;
    this.metrics.clicks += 1;
    await sleep(options.settle ?? 220);
  }

  async menu(trigger, item, options = {}) {
    await this.press(trigger, { settle: 280, ...options });
    try {
      await this.waitForText(item, { timeout: 1800 });
    } catch {
      const matches = await this.find(trigger);
      const target =
        matches.matches.find((match) => ["AXPopUpButton", "AXButton"].includes(match.role)) ??
        matches.matches[0];
      if (!target) throw new Error(`找不到菜单触发器：${trigger}`);
      await this.click(
        target.point.x + target.size.width / 2,
        target.point.y + target.size.height / 2,
        `回退点击菜单触发器：${trigger}`,
      );
      await this.waitForText(item);
    }
    await this.press(item, { role: "AXMenuItem", settle: 320, ...options });
    this.metrics.dialogs += 1;
  }

  async click(x, y, note = "") {
    this.ax.click(x, y);
    this.metrics.clicks += 1;
    if (note) this.notes.push(note);
    await sleep(200);
  }

  async clientClick(localX, localY, note = "") {
    const bounds = this.ax.window().bounds;
    await this.click(bounds.X + localX, bounds.Y + localY, note);
  }

  async clientDrag(x1, y1, x2, y2, note = "") {
    const bounds = this.ax.window().bounds;
    await this.drag(bounds.X + x1, bounds.Y + y1, bounds.X + x2, bounds.Y + y2, note);
  }

  async rightClick(x, y, note = "") {
    this.ax.rightClick(x, y);
    this.metrics.clicks += 1;
    if (note) this.notes.push(note);
    await sleep(250);
  }

  async doubleClick(x, y, note = "") {
    this.ax.doubleClick(x, y);
    this.metrics.clicks += 1;
    if (note) this.notes.push(note);
    await sleep(220);
  }

  async scroll(x, y, dy) {
    this.ax.scroll(x, y, dy);
    await sleep(180);
  }

  /** 把鼠标移到目标元素中心；用于验证悬停卡等指针态。 */
  async hover(text, note = "") {
    const target = (await this.waitForText(text, { timeout: 8000 }))[0];
    if (!target) throw new Error(`找不到悬停目标：${text}`);
    this.ax.hover(target.point.x + target.size.width / 2, target.point.y + target.size.height / 2);
    if (note) this.notes.push(note);
    await sleep(320);
  }

  async drag(x1, y1, x2, y2, note = "") {
    this.ax.drag(x1, y1, x2, y2);
    if (note) this.notes.push(note);
    await sleep(300);
  }

  async key(combo, note = "") {
    this.ax.key(combo);
    this.metrics.keys += 1;
    if (note) this.notes.push(note);
    await sleep(220);
  }

  async fill(query, text, note = "") {
    for (let attempt = 0; ; attempt += 1) {
      try {
        this.ax.fill(query, text);
        break;
      } catch (error) {
        if (!/找不到应用窗口/.test(error.message) || attempt >= 5) throw error;
        await sleep(300);
        try {
          this.ax.activate();
        } catch {
          // 下一次重试仍会重新查找窗口
        }
      }
    }
    this.metrics.fills += 1;
    if (note) this.notes.push(note);
    await sleep(220);
  }

  async paste(text, note = "") {
    this.ax.paste(text);
    if (note) this.notes.push(note);
    await sleep(220);
  }

  /** 处理系统打开/保存面板：Cmd+Shift+G 输入路径，再按面板按钮。 */
  async nativePath(pathValue, { button = "Open", settle = 500 } = {}) {
    this.metrics.dialogs += 1;
    // 系统面板异步弹出；过早按键会被丢弃，短等后重试打开“前往文件夹”。
    await sleep(500);
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
      await this.key("cmd+shift+g");
      try {
        await this.waitForText("Go to:", { timeout: 4000 });
        opened = true;
      } catch {
        await sleep(500);
      }
    }
    if (!opened) {
      // 面板/附属 sheet 处于模态循环时 AX 查询可能整树为空（2026-10-26 现场），
      // 但 CGEvent 按键仍会送达：盲走「粘贴路径 + 两次回车 + 点按钮」，由后续断言验证结果。
      this.notes.push("系统面板未响应 AX，按盲序列继续前往文件夹");
      await this.paste(pathValue);
      await this.key("return");
      await sleep(350);
      await this.key("return");
      await sleep(settle);
      try {
        await this.press(button, { timeout: 4000, settle });
      } catch {
        // 某些面板在第二次 Return 后已经提交。
      }
      return;
    }
    await this.paste(pathValue);
    await this.key("return");
    await sleep(350);
    await this.key("return");
    await sleep(settle);
    try {
      await this.press(button, { timeout: 4000, settle });
    } catch {
      // 某些面板在第二次 Return 后已经提交。
    }
  }

  async screenshot(name) {
    const window = this.ax.window();
    const target = path.join(this.screenshotDir, `${name}.png`);
    const result = spawnSync("screencapture", ["-x", "-l", String(window.windowId), target], {
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`截图失败：${result.stderr}`);
    this.metrics.screenshots += 1;
    return target;
  }

  file(relative) {
    return path.join(this.workspacePath, relative);
  }

  fixture(name) {
    return path.join(this.fixturesDir, name);
  }

  exportDir(name) {
    const directory = path.join(path.dirname(this.workspacePath), "exports", name);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  assertFile(relative) {
    const target = this.file(relative);
    assert.ok(fs.existsSync(target), `文件不存在：${target}`);
    return target;
  }

  async waitForDb(sql, params, predicate, { timeout = 12_000, interval = 200 } = {}) {
    return this._waitForQuery(() => this.db(sql, params), sql, predicate, timeout, interval);
  }

  async waitForGlobalDb(sql, params, predicate, { timeout = 12_000, interval = 200 } = {}) {
    return this._waitForQuery(() => this.globalDb(sql, params), sql, predicate, timeout, interval);
  }

  async _waitForQuery(run, sql, predicate, timeout, interval) {
    const deadline = Date.now() + timeout;
    let rows = [];
    while (Date.now() < deadline) {
      rows = run();
      if (predicate(rows)) return rows;
      await sleep(interval);
    }
    throw new Error(`等待数据库条件超时：${sql}（最后 ${JSON.stringify(rows)}）`);
  }

  async waitForPath(target, { timeout = 15_000, interval = 200 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (fs.existsSync(target)) return target;
      await sleep(interval);
    }
    throw new Error(`等待文件超时：${target}`);
  }

  readJson(relative) {
    return JSON.parse(fs.readFileSync(this.file(relative), "utf8"));
  }

  db(sql, params = []) {
    return this._query(path.join(this.workspacePath, "db/workspace.sqlite3"), sql, params);
  }

  /** 直接执行工作区 SQL；仅用于构造并发/冲突前置条件，业务操作仍走 UI。 */
  exec(sql, params = []) {
    const databasePath = path.join(this.workspacePath, "db/workspace.sqlite3");
    assert.ok(fs.existsSync(databasePath), `数据库不存在：${databasePath}`);
    const db = new DatabaseSync(databasePath);
    try {
      return db.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  }

  globalDb(sql, params = []) {
    return this._query(path.join(this.homePath, "db/starris.db"), sql, params);
  }

  _query(databasePath, sql, params = []) {
    assert.ok(fs.existsSync(databasePath), `数据库不存在：${databasePath}`);
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const statement = db.prepare(sql);
      return params.length > 0 ? statement.all(...params) : statement.all();
    } finally {
      db.close();
    }
  }

  log(note) {
    this.notes.push(note);
  }

  finding(severity, title, detail) {
    this.findings.push({ severity, title, detail });
  }
}

/** 常用等待：弹窗标题出现。 */
export async function waitForAnyText(ctx, texts, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 15_000);
  while (Date.now() < deadline) {
    for (const text of texts) {
      try {
        const found = ctx.ax.find(text);
        if (found.count > 0) return text;
      } catch {
        // 继续轮询
      }
    }
    await sleep(options.interval ?? 200);
  }
  throw new Error(`等待任一文本超时：${texts.join(" / ")}`);
}
