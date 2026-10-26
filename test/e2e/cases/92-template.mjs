/**
 * 模板库：当前文档另存为模板、从模板创建、删除。
 */
export default {
  id: "92-template",
  title: "模板库 · 文档另存 · 从模板创建 · 删除",
  area: "模板",
  steps: [
    {
      action: "更多 → 模板库，另存当前文档",
      ui: "更多菜单 → 模板库 → 模板名称 → 另存为模板",
      clicks: 3,
      dialogs: 1,
      typing: 1,
    },
    {
      action: "使用模板创建新文档",
      ui: "模板列表 → 使用模板",
      clicks: 1,
      dialogs: 0,
      note: "新文档应包含原正文。",
    },
    {
      action: "重新打开模板库并删除模板",
      ui: "更多 → 模板库 → 删除 → 确认删除",
      clicks: 4,
      dialogs: 1,
    },
  ],
  complexity: {
    clickTotal: 8,
    dialogs: 2,
    typingFields: 1,
    assessment:
      "模板入口在更多菜单，另存与使用各两到三步；模板复用文档/画板内容快照，不复制附件字节。删除需要二次点击，避免误删。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");
    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 10_000 });

    await ctx.menu("更多 ⌘J", "模板库");
    await ctx.expectText("另存为模板", { timeout: 5000 });
    await ctx.fill("模板名称", "E2E 模板");
    await ctx.press("另存为模板");
    await ctx.expectText("使用模板 E2E 模板", { timeout: 8000 });
    await ctx.screenshot("template-saved");

    await ctx.press("使用模板 E2E 模板");
    await ctx.expectText("E2E 模板", { timeout: 10_000 });
    await ctx.expectText("黑盒测试正文", { timeout: 10_000 });
    await ctx.screenshot("template-created");

    await ctx.menu("更多 ⌘J", "模板库");
    await ctx.expectText("删除模板 E2E 模板", { timeout: 5000 });
    await ctx.press("删除模板 E2E 模板");
    await ctx.expectText("确认删除模板 E2E 模板", { timeout: 5000 });
    await ctx.press("确认删除模板 E2E 模板");
    await ctx.expectGone("模板 E2E 模板", { timeout: 8000 });
    await ctx.press("关闭");
  },
};
