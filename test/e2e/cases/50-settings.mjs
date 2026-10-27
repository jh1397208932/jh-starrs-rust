import assert from "node:assert/strict";

/** 设置：主题切换、存储附件上传、把附件插入画板。 */
export default {
  id: "50-settings",
  title: "设置 · 明暗主题 · 附件上传 · 附件插入画板",
  area: "设置 / 附件",
  steps: [
    {
      action: "更多 → 设置 → 外观",
      ui: "侧栏底部更多菜单 → 设置弹窗左侧「外观」",
      clicks: 3,
      dialogs: 1,
      note: "设置弹窗默认通用页，外观为第二项。",
    },
    {
      action: "切换深色 → 浅色",
      ui: "外观页明暗模式卡片",
      clicks: 2,
      dialogs: 0,
      note: "验证 global settings 写入并恢复浅色。",
    },
    {
      action: "设置 → 存储 → 上传 pixel.png",
      ui: "设置弹窗「存储」页附件管理区",
      clicks: 3,
      dialogs: 1,
      note: "系统文件面板选择测试 fixture。",
    },
    {
      action: "查看快捷键/关于页并关闭设置",
      ui: "设置弹窗左侧标签栏；右上关闭",
      clicks: 4,
      dialogs: 0,
    },
    {
      action: "画板页头「插入附件」选择 pixel.png",
      ui: "E2E Board 页头 → 插入附件选择器",
      clicks: 3,
      dialogs: 1,
      note: "验证附件 object_id 插入画板并触发保存。",
    },
  ],
  complexity: {
    clickTotal: 15,
    dialogs: 3,
    typingFields: 0,
    assessment:
      "主题切换在设置→外观两步内完成，反馈即时。附件上传与插入被拆到“设置→存储”和“画板页头”两个入口；前者是管理动作、后者是使用动作，职责清楚，但上传后回画板插入需要先关闭设置、再开选择器。若高频插图，画板页头的插入选择器内提供“上传”会更顺手。",
  },
  async run(ctx) {
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("外观", { role: "AXRadioButton" });
    await ctx.expectText("主题", { timeout: 5000 });
    await ctx.press("深色", { role: "AXCheckBox" });
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'appearance.mode'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "dark",
    );
    await ctx.screenshot("settings-dark");
    await ctx.press("浅色", { role: "AXCheckBox" });
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'appearance.mode'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "light",
    );

    await ctx.press("存储", { role: "AXRadioButton" });
    await ctx.expectText("上传", { timeout: 8000 });
    await ctx.screenshot("settings-storage");
    await ctx.press("上传");
    await ctx.nativePath(ctx.fixture("pixel.png"), { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT name, mime, status FROM attachment WHERE name = 'pixel.png' AND status = 'active'",
      [],
      (rows) => rows.length >= 1,
      { timeout: 20_000 },
    );

    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.expectText("更多菜单", { timeout: 5000 });
    await ctx.press("关于", { role: "AXRadioButton" });
    await ctx.expectText("本地工作区版", { timeout: 5000 });
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) {
      // 独立运行（未先跑 40-board）时没有画板可插，跳过插入段以验证设置页本身。
      ctx.log("跳过附件插入画板：本运行未创建画板");
      return;
    }
    await ctx.press(boardTitle);
    await ctx.expectText("插入附件", { timeout: 8000 });
    await ctx.press("插入附件");
    await ctx.expectText("pixel.png", { timeout: 8000 });
    await ctx.press("pixel.png");
    ctx.metrics.dialogs += 1;

    const node = ctx.db("SELECT id FROM node WHERE title = ?", [boardTitle])[0];
    const previous = ctx.shared.boardElementCount ?? 0;
    const scenes = await ctx.waitForDb(
      "SELECT element_count FROM board_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].element_count > previous,
      { timeout: 20_000 },
    );
    assert.ok(scenes[0].element_count > previous, "附件插入后画板元素未增加");
    ctx.shared.attachmentName = "pixel.png";
    await ctx.screenshot("settings-attachment-inserted");
    ctx.log(`画板元素 ${previous} → ${scenes[0].element_count}`);
  },
};
