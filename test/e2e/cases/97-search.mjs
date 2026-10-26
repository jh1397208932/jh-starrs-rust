/**
 * 检索：标题/正文搜索、2 字回退、结果打开、文档内查找、快速跳转。
 */
export default {
  id: "97-search",
  title: "检索 · 标题/正文搜索 · 文档内查找 · 快速跳转",
  area: "检索 / 编辑器",
  steps: [
    {
      action: "打开全局搜索并输入“黑盒测试”",
      ui: "顶栏搜索胶囊 → 搜索面板",
      clicks: 1,
      dialogs: 1,
      typing: 1,
      note: "应命中 E2E Doc 并显示正文片段。",
    },
    {
      action: "点击搜索结果打开文档",
      ui: "搜索面板结果",
      clicks: 1,
      dialogs: 0,
    },
    {
      action: "⌘F 打开文档内查找，输入“黑盒”",
      ui: "文档页内查找条",
      clicks: 0,
      dialogs: 0,
      typing: 1,
      note: "显示 1 / 1，Esc 关闭。",
    },
    {
      action: "⌘K 打开快速跳转",
      ui: "全局快捷键",
      clicks: 0,
      dialogs: 0,
      note: "被 WebView 保留时记录发现，不判失败。",
    },
  ],
  complexity: {
    clickTotal: 3,
    dialogs: 1,
    typingFields: 2,
    assessment:
      "搜索面板把标题、类型、知识库和正文片段放在一行内，点击结果直接打开；2 字查询走 LIKE 回退，用户不需要理解索引实现。文档内查找只做高亮与跳转，不修改正文。快速跳转复用同一面板，空查询显示最近节点。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");

    await ctx.press("全局搜索");
    await ctx.expectText("搜索标题与正文…", { timeout: 5000 });
    await ctx.fill("搜索", "黑盒测试");
    await ctx.expectText(`打开 ${docTitle}`, { timeout: 8000 });
    await ctx.screenshot("search-results");
    await ctx.press(`打开 ${docTitle}`);
    await ctx.expectText("文档正文", { timeout: 10_000 });

    await ctx.key("cmd+f");
    await ctx.expectText("文档内查找", { timeout: 5000 });
    await ctx.fill("查找内容", "黑盒");
    await ctx.expectText("1 / 1", { timeout: 5000 });
    await ctx.screenshot("doc-find");
    await ctx.key("escape");
    await ctx.expectGone("文档内查找", { timeout: 5000 });

    // 2 字查询走 LIKE 回退。
    await ctx.press("全局搜索");
    await ctx.expectText("搜索标题与正文…", { timeout: 5000 });
    await ctx.fill("搜索", "黑盒");
    await ctx.expectText(`打开 ${docTitle}`, { timeout: 8000 });
    await ctx.key("escape");

    try {
      await ctx.key("cmd+k");
      await ctx.expectText("跳转到最近内容…", { timeout: 3000 });
      ctx.log("⌘K 快速跳转可用");
      await ctx.key("escape");
    } catch {
      ctx.finding(
        "low",
        "⌘K 快速跳转在 WKWebView 下未触发",
        "顶栏搜索可用；⌘K 可能被 WebView 保留键截获。可在 Tauri 菜单层注册或改用非保留组合。",
      );
    }
  },
};
