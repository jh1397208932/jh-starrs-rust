/**
 * 文档冲突：前端持旧版本保存时保留本地内容并要求重新加载。
 */
export default {
  id: "98-doc-conflict",
  title: "文档冲突 · 旧版本保存被拒绝 · 重新加载",
  area: "文档 / 并发",
  steps: [
    {
      action: "打开 E2E Doc 并写入基线内容",
      ui: "文件树 → E2E Doc",
      clicks: 1,
      dialogs: 0,
      typing: 1,
    },
    {
      action: "直接推进数据库 doc_version，模拟另一个实例已保存",
      ui: "测试数据库（仅构造前置条件）",
      clicks: 0,
      dialogs: 0,
    },
    {
      action: "继续编辑，等待冲突提示",
      ui: "文档正文 / 保存状态",
      clicks: 0,
      dialogs: 0,
      typing: 1,
      note: "数据库必须保留冲突前内容。",
    },
    {
      action: "放弃修改并重新加载，再保存",
      ui: "冲突提示条 → 放弃修改并重新加载",
      clicks: 1,
      dialogs: 0,
      typing: 1,
    },
  ],
  complexity: {
    clickTotal: 2,
    dialogs: 0,
    typingFields: 3,
    assessment:
      "冲突检测把版本比较放在保存事务内，旧实例不会静默覆盖新内容；前端保留编辑器内容并提供显式重新加载。冲突提示条比普通 toast 更可操作，但“放弃修改”是不可逆动作，文案已明确说明。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");

    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 15_000 });
    await ctx.fill("文档正文", "冲突前内容");
    await ctx.expectText("已保存", { timeout: 15_000 });

    ctx.exec("UPDATE node SET doc_version = doc_version + 1 WHERE title = ?", [docTitle]);
    ctx.log("已通过测试数据库推进 doc_version，模拟另一实例保存");

    await ctx.fill("文档正文", "冲突后内容");
    await ctx.expectText("文档已在别处更新", { timeout: 10_000 });
    await ctx.screenshot("doc-conflict");

    const rows = ctx.db("SELECT content FROM node WHERE title = ?", [docTitle]);
    if (!rows[0]?.content.includes("冲突前内容")) {
      throw new Error("冲突后数据库内容被覆盖");
    }
    if (rows[0].content.includes("冲突后内容")) {
      throw new Error("冲突内容不应写入数据库");
    }

    await ctx.press("放弃修改并重新加载");
    await ctx.expectGone("文档已在别处更新", { timeout: 10_000 });
    await ctx.expectText("冲突前内容", { timeout: 10_000 });

    await ctx.fill("文档正文", "恢复后保存");
    await ctx.expectText("已保存", { timeout: 15_000 });
    const saved = ctx.db("SELECT content, doc_version FROM node WHERE title = ?", [docTitle]);
    if (!saved[0]?.content.includes("恢复后保存")) {
      throw new Error("重新加载后的保存未落库");
    }
    ctx.log(`重新加载后保存成功，doc_version=${saved[0].doc_version}`);
    await ctx.screenshot("doc-conflict-recovered");
  },
};
