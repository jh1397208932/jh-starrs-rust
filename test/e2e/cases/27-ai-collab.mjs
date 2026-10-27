/**
 * AI 协作：设置页权限矩阵与待审区入口。
 */
export default {
  id: "27-ai-collab",
  title: "AI 协作 · 写权限设置 · 待审区入口",
  area: "设置 / AI 协作",
  steps: [
    {
      action: "打开设置 → AI 协作",
      ui: "更多 ⌘J → 设置 → AI 协作",
      clicks: 3,
      dialogs: 1,
      typing: 0,
      note: "三个作用域各有只读/需确认/可编辑三档。默认「需人工确认」。",
    },
    {
      action: "切换到只读并切回",
      ui: "文档作用域 → 只读 → 需人工确认",
      clicks: 2,
      dialogs: 0,
      typing: 0,
      note: "权限写入 workspace_meta，重开设置仍保持。",
    },
    {
      action: "确认待审区空态",
      ui: "AI 协作页底部",
      clicks: 0,
      dialogs: 0,
      typing: 0,
      note: "没有待确认写入时显示空态文案。",
    },
  ],
  complexity: {
    clickTotal: 5,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "权限按作用域分档，默认为最安全的「需人工确认」；待审区与审计同页，AI 写入必须先过人这一关。",
  },
  async run(ctx) {
    await ctx.press("更多 ⌘J");
    await ctx.press("设置");
    await ctx.press("AI 协作");
    await ctx.expectText("待审区", { timeout: 10_000 });
    await ctx.expectText("需人工确认", { timeout: 8000 });
    await ctx.expectText("可编辑", { timeout: 8000 });

    await ctx.press("只读");
    await ctx.waitForDb(
      "SELECT value FROM workspace_meta WHERE key = 'ai.permissions'",
      [],
      (rows) => rows.length === 1 && rows[0].value.includes('"doc":"read-only"'),
      { timeout: 8000 },
    );
    await ctx.press("需人工确认");
    await ctx.expectText("没有待确认的 AI 写入", { timeout: 8000 });

    // 关闭设置弹窗，否则模态遮罩会挡住后续用例
    await ctx.press("完成");
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });
    ctx.log("AI 协作权限可切换并落库，待审区空态可见；设置弹窗已关闭。");
  },
};
