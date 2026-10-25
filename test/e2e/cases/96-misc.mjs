import fs from "node:fs";
import path from "node:path";

/** 占位视图、全局搜索 mock、窗口最大化/还原、附件校验/导出/删除。 */
export default {
  id: "96-misc",
  title: "表格/流程图占位 · 全局搜索 mock · 附件校验/导出/删除",
  area: "占位视图 / 附件管理",
  steps: [
    {
      action: "新建并打开表格 E2E Table",
      ui: "新建内容 → 表格",
      clicks: 3,
      dialogs: 1,
      typing: 1,
      note: "验证「表格」占位。",
    },
    {
      action: "新建并打开流程图 E2E Flow",
      ui: "新建内容 → 流程图",
      clicks: 3,
      dialogs: 1,
      typing: 1,
      note: "验证「流程图」占位。",
    },
    {
      action: "删除两个占位节点",
      ui: "文件树行 ⋯ → 删除 → 确认 ×2",
      clicks: 8,
      dialogs: 2,
    },
    {
      action: "点击顶栏全局搜索",
      ui: "窗口右上搜索框",
      clicks: 1,
      dialogs: 0,
      note: "占位动作，点击提示「即将推出」。",
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
    clickTotal: 20,
    dialogs: 6,
    typingFields: 2,
    assessment:
      "表格/流程图仍以占位视图承接，用户能打开但无法编辑；适合在入口标注“即将支持”。全局搜索点击与 ⌘⇧F 的行为需要在真实 WebView 下统一，避免“点得到、按不出”。附件管理把校验/导出/删除集中在一行，删除需二次确认；导出仍走系统保存。macOS 使用系统红绿灯，自绘窗口按钮仅在 Windows/Linux 生效，本轮未把系统窗口操作纳入应用功能判定。",
  },
  async run(ctx) {
    const createPlaceholder = async (kind, title, placeholder) => {
      await ctx.press("新建内容");
      await ctx.expectText("创建");
      await ctx.press(kind, { role: "AXCheckBox", settle: 180 });
      await ctx.fill("名称", title);
      await ctx.press("创建");
      await ctx.expectText(placeholder, { timeout: 8000 });
      ctx.metrics.dialogs += 1;
      ctx.metrics.fills += 1;
    };

    await createPlaceholder("表格", "E2E Table", "即将推出");
    await createPlaceholder("流程图", "E2E Flow", "即将推出");
    await ctx.screenshot("placeholders");

    for (const title of ["E2E Table", "E2E Flow"]) {
      await ctx.menu(`${title} 操作`, "删除");
      await ctx.expectText(`删除「${title}」？`);
      await ctx.press("删除");
      await new Promise((resolve) => setTimeout(resolve, 500));
      const remaining = ctx.db("SELECT COUNT(*) AS count FROM node WHERE title = ?", [title])[0].count;
      if (remaining !== 0) throw new Error(`${title} 未删除`);
    }

    const searchButtons = (await ctx.find("全局搜索")).matches;
    const visibleSearch = searchButtons.find((match) => match.size.width > 100);
    if (visibleSearch) {
      await ctx.click(
        visibleSearch.point.x + visibleSearch.size.width / 2,
        visibleSearch.point.y + visibleSearch.size.height / 2,
        "点击顶栏可见搜索胶囊",
      );
    } else {
      await ctx.press("全局搜索");
    }
    try {
      await ctx.expectText("即将推出", { timeout: 3000 });
      ctx.log("全局搜索点击出现「即将推出」toast");
    } catch {
      ctx.finding(
        "low",
        "全局搜索栏点击未见反馈",
        "源码中点击调用 showMockToast，但黑盒点击未观察到提示；结合 ⌘⇧F 也未触发，建议检查搜索按钮的可见/隐藏双实例与快捷键冲突。",
      );
    }
    await ctx.screenshot("global-search-mock");

    // 附件校验/导出/删除：上传一个独立、无引用的文件，避免与文档/画板附件重名。
    const exportDir = ctx.exportDir("attachment");
    const sourceDir = ctx.exportDir("attachment-src");
    fs.mkdirSync(sourceDir, { recursive: true });
    const source = path.join(sourceDir, "lifecycle.txt");
    fs.writeFileSync(source, "lifecycle");
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("存储", { role: "AXRadioButton" });
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

    ctx.log("附件校验/导出/删除/恢复/清理、占位视图、搜索 mock 完成；macOS 窗口控制为系统红绿灯，不计入应用功能。");
  },
};
