/**
 * 画板放映：页头放映、固定层、Esc 退出。
 */
export default {
  id: "93-board-present",
  title: "画板放映 · 进入与 Esc 退出",
  area: "画板",
  steps: [
    {
      action: "打开 E2E Board 并点击放映",
      ui: "文件树 → 画板页头「放映」",
      clicks: 2,
      dialogs: 0,
    },
    {
      action: "Esc 退出放映",
      ui: "放映层",
      clicks: 0,
      dialogs: 0,
      note: "退出按钮与 Esc 都可用。",
    },
  ],
  complexity: {
    clickTotal: 2,
    dialogs: 0,
    typingFields: 0,
    assessment:
      "放映入口在画板页头，一键进入固定层并尝试全屏；Esc 或右上角按钮退出。进入后隐藏页头，减少展示干扰。",
  },
  async run(ctx) {
    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) throw new Error("缺少 E2E Board");
    await ctx.press(boardTitle);
    await ctx.expectText("画板", { timeout: 10_000 });
    await ctx.press("放映画板");
    await ctx.expectText("退出放映 (Esc)", { timeout: 5000 });
    await ctx.screenshot("board-presenting");
    await ctx.key("escape");
    await ctx.expectGone("退出放映 (Esc)", { timeout: 5000 });
  },
};
