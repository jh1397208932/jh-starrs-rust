import fs from "node:fs";
import path from "node:path";

/** 新建入口收敛、搜索禁用、窗口最大化/还原、附件校验/导出/删除。 */
export default {
  id: "96-misc",
  title: "新建入口收敛 · 搜索禁用 · 附件校验/导出/删除",
  area: "入口诚实化 / 附件管理",
  steps: [
    {
      action: "打开新建弹窗检查类型",
      ui: "文件树标题 +",
      clicks: 1,
      dialogs: 1,
      note: "文件夹/文档/画板/表格/流程图五类均可创建。",
    },
    {
      action: "打开并关闭全局搜索",
      ui: "顶栏搜索胶囊",
      clicks: 1,
      dialogs: 1,
      note: "搜索面板可用，Esc 关闭。",
    },
    {
      action: "设置 → 存储：修改回收站保留时间为 14 天",
      ui: "设置存储页「保留时间」",
      clicks: 2,
      dialogs: 0,
      typing: 1,
      note: "保存后写入工作区配置。",
    },
    {
      action: "设置 → 存储：校验/导出/删除 pixel.png",
      ui: "设置存储页附件行",
      clicks: 5,
      dialogs: 2,
      note: "导出到测试目录；删除本地测试对象。",
    },
  ],
  complexity: {
    clickTotal: 9,
    dialogs: 3,
    typingFields: 1,
    assessment:
      "表格与流程图分别复用文档编辑器与画板，创建入口保持五类并列。保留时间可在设置内调整并立即写入工作区配置。全局搜索已接入真实索引，顶栏可打开面板、Esc 关闭。附件管理把校验/导出/删除集中在一行，删除需二次确认；导出仍走系统保存。macOS 使用系统红绿灯，自绘窗口按钮仅在 Windows/Linux 生效，本轮未把系统窗口操作纳入应用功能判定。",
  },
  async run(ctx) {
    await ctx.press("新建内容");
    await ctx.expectText("创建", { timeout: 5000 });
    const folder = (await ctx.find("文件夹")).matches.length;
    const doc = (await ctx.find("文档")).matches.length;
    const board = (await ctx.find("画板")).matches.length;
    const table = (await ctx.find("表格")).matches.length;
    const flow = (await ctx.find("流程图")).matches.length;
    if (folder === 0 || doc === 0 || board === 0 || table === 0 || flow === 0) {
      throw new Error("新建弹窗缺少文件夹/文档/画板/表格/流程图类型");
    }
    await ctx.press("取消");
    ctx.metrics.dialogs += 1;
    ctx.log("新建弹窗提供文件夹/文档/画板/表格/流程图");
    await ctx.screenshot("create-kinds");

    const search = (await ctx.find("全局搜索")).matches;
    if (search.length === 0) {
      throw new Error("顶栏搜索入口不存在");
    }
    await ctx.press("全局搜索");
    await ctx.expectText("搜索标题与正文…", { timeout: 5000 });
    await ctx.key("escape");
    ctx.metrics.dialogs += 1;
    ctx.log("全局搜索面板可打开并用 Esc 关闭");

    // 附件校验/导出/删除：上传一个独立、无引用的文件，避免与文档/画板附件重名。
    const exportDir = ctx.exportDir("attachment");
    const sourceDir = ctx.exportDir("attachment-src");
    fs.mkdirSync(sourceDir, { recursive: true });
    const source = path.join(sourceDir, "lifecycle.txt");
    fs.writeFileSync(source, "lifecycle");
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("存储", { role: "AXRadioButton" });
    await ctx.fill("回收站保留天数", "14");
    await ctx.press("保存");
    await ctx.expectText("已保存", { timeout: 5000 });
    await ctx.waitForDb(
      "SELECT value FROM workspace_meta WHERE key = 'attachment.trash_retention_days'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "14",
      { timeout: 8000 },
    );
    await ctx.press("上传");
    await ctx.nativePath(source, { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.expectText("lifecycle.txt", { timeout: 8000 });

    await ctx.press("校验 lifecycle.txt");
    await ctx.expectText("校验通过", { timeout: 8000 });
    await ctx.press("导出 lifecycle.txt");
    await ctx.nativePath(exportDir, { button: "Save" });
    ctx.metrics.dialogs += 1;
    const exported = path.join(exportDir, "lifecycle.txt");
    await ctx.waitForPath(exported, { timeout: 15_000 });
    if (fs.statSync(exported).size !== fs.statSync(source).size) {
      throw new Error("导出的 lifecycle.txt 大小异常");
    }

    await ctx.press("删除 lifecycle.txt");
    await ctx.expectText("确认", { timeout: 5000 });
    await ctx.press("确认");
    await ctx.waitForDb(
      "SELECT status FROM attachment WHERE name = 'lifecycle.txt' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].status === "deleted",
      { timeout: 10_000 },
    );

    // 回收站恢复后再删除，验证软删除闭环。
    await ctx.press("回收站");
    await ctx.expectText("恢复 lifecycle.txt", { timeout: 5000 });
    await ctx.press("恢复 lifecycle.txt");
    await ctx.waitForDb(
      "SELECT status FROM attachment WHERE name = 'lifecycle.txt' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].status === "active",
      { timeout: 10_000 },
    );
    await ctx.press("删除 lifecycle.txt");
    await ctx.expectText("确认", { timeout: 5000 });
    await ctx.press("确认");
    await ctx.waitForDb(
      "SELECT status FROM attachment WHERE name = 'lifecycle.txt' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].status === "deleted",
      { timeout: 10_000 },
    );
    await ctx.press("立即清理");
    await ctx.expectText("已清理", { timeout: 10_000 });
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    ctx.log("附件校验/导出/删除/恢复/清理、入口收敛完成；macOS 窗口控制为系统红绿灯，不计入应用功能。");
  },
};
