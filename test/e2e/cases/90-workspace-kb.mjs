import assert from "node:assert/strict";

/** 知识库与工作区管理、收藏页、小记快捷动作。 */
export default {
  id: "90-workspace-kb",
  title: "知识库管理 · 收藏页 · 小记快捷创建",
  area: "工作区 / 知识库",
  steps: [
    {
      action: "切换工作区浮层 → 新建知识库",
      ui: "左上角工作区名 → 浮层底部「新建知识库」",
      clicks: 3,
      dialogs: 2,
      typing: 1,
      note: "新建 E2E KB，验证数据库与侧栏。",
    },
    {
      action: "切回默认知识库",
      ui: "工作区切换浮层知识库列表",
      clicks: 2,
      dialogs: 0,
    },
    {
      action: "打开知识库管理并删除测试知识库",
      ui: "切换浮层 → 管理知识库 → 行内 ⋯ → 删除 → 确认",
      clicks: 6,
      dialogs: 3,
    },
    {
      action: "打开管理工作区并关闭",
      ui: "切换浮层 → 管理工作区",
      clicks: 2,
      dialogs: 1,
    },
    {
      action: "收藏 E2E Doc → 打开收藏页",
      ui: "文档页头星标 → 侧栏「收藏」快捷入口",
      clicks: 2,
      dialogs: 0,
    },
    {
      action: "小记快捷创建",
      ui: "侧栏「小记」快捷入口 → 新建弹窗",
      clicks: 2,
      dialogs: 1,
      typing: 1,
      note: "默认文档类型与「小记」标题。",
    },
  ],
  complexity: {
    clickTotal: 17,
    dialogs: 7,
    typingFields: 2,
    assessment:
      "知识库的新建/切换/管理集中在工作区浮层，管理弹窗支持行内操作与删除确认。新建知识库需要先开浮层再开弹窗；对高频切换可以接受，对连续创建则偏重。收藏页和小记都是一键入口，小记仍复用新建弹窗（可改标题），符合“快速记录”但还能再简化成直接创建。",
  },
  async run(ctx) {
    // Radix 弹出层偶尔吞掉 AXPress；补一次坐标点击，避免整条用例因浮层没打开而失败。
    const openWorkspaceSwitch = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await ctx.press("切换工作区", { settle: 280 });
        try {
          await ctx.expectText("新建知识库", { timeout: 2200 });
          return;
        } catch {
          // 走坐标回退
        }
        const matches = await ctx.find("切换工作区");
        const target =
          matches.matches.find((match) => match.role === "AXButton") ?? matches.matches[0];
        if (target) {
          await ctx.click(
            target.point.x + target.size.width / 2,
            target.point.y + target.size.height / 2,
            "回退点击工作区切换",
          );
          try {
            await ctx.expectText("新建知识库", { timeout: 2200 });
            return;
          } catch {
            // 下一轮重试
          }
        }
        await ctx.key("escape");
      }
      throw new Error("工作区切换浮层未打开");
    };

    // 新建测试知识库
    await openWorkspaceSwitch();
    await ctx.press("新建知识库");
    await ctx.expectText("知识库");
    await ctx.fill("例如：产品灵感库", "E2E KB");
    await ctx.press("创建");
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT name FROM knowledge_base WHERE name = 'E2E KB'",
      [],
      (rows) => rows.length === 1,
    );
    await ctx.screenshot("workspace-kb-created");

    // 切回默认知识库
    await openWorkspaceSwitch();
    await ctx.press("默认知识库");
    await ctx.expectText("E2E Doc", { timeout: 10_000 });

    // 删除测试知识库
    await openWorkspaceSwitch();
    await ctx.press("管理知识库");
    await ctx.expectText("知识库管理");
    await ctx.press("E2E KB 操作");
    await ctx.expectText("删除");
    await ctx.press("删除", { role: "AXMenuItem" });
    await ctx.expectText("删除知识库「E2E KB」？");
    await ctx.press("删除");
    ctx.metrics.dialogs += 2;
    await ctx.waitForDb(
      "SELECT name FROM knowledge_base WHERE name = 'E2E KB'",
      [],
      (rows) => rows.length === 0,
    );
    await ctx.press("关闭");

    // 管理工作区
    await openWorkspaceSwitch();
    await ctx.press("管理工作区");
    await ctx.expectText("工作区管理");
    await ctx.expectText("E2E 工作区");
    await ctx.screenshot("workspace-manager");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    // 收藏页
    await ctx.press("E2E Doc");
    await ctx.expectText("文档正文", { timeout: 8000 });
    await ctx.press("收藏 (⌘D)");
    await ctx.expectText("取消收藏 (⌘D)", { timeout: 5000 });
    await ctx.press("收藏");
    await ctx.expectText("E2E Doc", { timeout: 8000 });
    await ctx.screenshot("starred-page");
    await ctx.press("E2E Doc");

    // 小记
    await ctx.press("小记");
    await ctx.expectText("创建", { timeout: 5000 });
    await ctx.fill("名称", "E2E Note");
    await ctx.press("创建");
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT title, type FROM node WHERE title = 'E2E Note'",
      [],
      (rows) => rows.length === 1 && rows[0].type === 2,
    );
    ctx.log("E2E KB 创建/切换/删除、收藏页和小记均完成。");
    await ctx.screenshot("workspace-quick-note");
  },
};
