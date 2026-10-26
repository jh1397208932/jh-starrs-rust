/**
 * 文档历史：自动快照列表与恢复。
 */
export default {
  id: "94-doc-history",
  title: "文档历史 · 快照列表 · 恢复",
  area: "文档",
  steps: [
    {
      action: "打开 E2E Doc 的「历史版本」",
      ui: "文档页头 → 历史版本",
      clicks: 2,
      dialogs: 1,
    },
    {
      action: "恢复最早快照",
      ui: "历史版本列表 → 恢复",
      clicks: 1,
      dialogs: 0,
      note: "恢复后重新加载正文。",
    },
  ],
  complexity: {
    clickTotal: 3,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "历史快照每 10 分钟最多一份，首次保存也保留；恢复走正常保存与版本校验，恢复后编辑器重新加载，避免本地旧内容覆盖。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");
    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 10_000 });
    await ctx.press("历史版本");
    await ctx.expectText("历史版本", { timeout: 5000 });
    await ctx.expectText("恢复", { timeout: 5000 });
    await ctx.screenshot("doc-history");
    await ctx.press("恢复");
    await ctx.expectText("文档正文", { timeout: 10_000 });
    await ctx.expectText("已保存", { timeout: 10_000 });
  },
};
