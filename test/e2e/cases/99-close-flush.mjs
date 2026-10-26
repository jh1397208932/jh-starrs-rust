/**
 * 关闭保存：输入后立刻 ⌘Q，守卫必须在防抖计时器触发前落盘并退出。
 *
 * 本用例会关闭应用，必须放在用例列表最后。
 */
export default {
  id: "99-close-flush",
  title: "关闭保存 · 输入后立即 ⌘Q",
  area: "数据安全 / 退出",
  steps: [
    {
      action: "打开 E2E Doc 并确认已保存",
      ui: "文件树 → E2E Doc",
      clicks: 1,
      dialogs: 0,
    },
    {
      action: "写入最后一句后立即按 ⌘Q",
      ui: "文档正文 / 系统退出",
      clicks: 0,
      dialogs: 0,
      typing: 1,
      note: "不等 1s 自动保存防抖。",
    },
    {
      action: "读取数据库确认最后一句已落盘",
      ui: "测试数据库",
      clicks: 0,
      dialogs: 0,
      note: "450ms 内必须出现，早于 1s 自动保存防抖，证明退出守卫先 flush。",
    },
  ],
  complexity: {
    clickTotal: 1,
    dialogs: 0,
    typingFields: 2,
    assessment:
      "关闭守卫覆盖窗口关闭与应用退出；用户无需等待自动保存。用例以 450ms 为界，早于 1s 防抖，能区分“守卫保存”与“防抖碰巧保存”。⌘Q 后应用退出，因此该用例固定放在最后。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");

    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 15_000 });
    await ctx.expectText("已保存", { timeout: 15_000 });

    const marker = `关闭前最后一句-${Date.now()}`;
    await ctx.fill("文档正文", marker);
    await ctx.key("cmd+q");

    const rows = await ctx.waitForDb(
      "SELECT content FROM node WHERE title = ?",
      [docTitle],
      (found) => found.length === 1 && found[0].content.includes(marker),
      { timeout: 450, interval: 25 },
    );
    if (!rows[0]?.content.includes(marker)) {
      throw new Error("⌘Q 退出前未落盘最后一句");
    }
    ctx.log("⌘Q 退出守卫在 450ms 内完成落盘");
  },
};
