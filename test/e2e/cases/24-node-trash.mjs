/**
 * 文件回收站：删除节点 → 回收站恢复 → 再删除并永久清除。
 */
export default {
  id: "24-node-trash",
  title: "文件回收站 · 删除 · 恢复 · 永久删除",
  area: "文件树 / 回收站",
  steps: [
    {
      action: "新建并删除文档 E2E Trash",
      ui: "新建内容 → 文档 → 行内 ⋯ → 删除 → 确认",
      clicks: 5,
      dialogs: 2,
      typing: 1,
      note: "删除后不再出现在文件树，但保留在回收站。",
    },
    {
      action: "打开回收站并恢复",
      ui: "更多 → 回收站 → 恢复 E2E Trash",
      clicks: 3,
      dialogs: 1,
      note: "恢复后回到根级并重新出现在文件树。",
    },
    {
      action: "再次删除并永久删除",
      ui: "行内 ⋯ → 删除 → 确认 → 更多 → 回收站 → 永久删除 ×2",
      clicks: 8,
      dialogs: 2,
      note: "永久删除需要二次确认，数据库行真正移除。",
    },
  ],
  complexity: {
    clickTotal: 16,
    dialogs: 5,
    typingFields: 1,
    assessment:
      "删除现在进入回收站，误删可在两步内恢复；永久删除放在回收站内并需二次确认，避免误触。回收站入口在「更多」菜单，低频操作不占主界面。",
  },
  async run(ctx) {
    const title = "E2E Trash";
    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.fill("名称", title);
    await ctx.press("创建");
    await ctx.expectText(title, { timeout: 10_000 });
    await ctx.expectText(`${title} 操作`, { timeout: 10_000 });
    ctx.metrics.dialogs += 1;

    await ctx.menu(`${title} 操作`, "删除");
    await ctx.expectText(`删除「${title}」？`);
    await ctx.press("删除");
    await ctx.waitForDb(
      "SELECT deleted_at FROM node WHERE title = ?",
      [title],
      (rows) => rows.length === 1 && rows[0].deleted_at !== null,
      { timeout: 10_000 },
    );
    await ctx.expectGone(title, { timeout: 5000 });

    await ctx.menu("更多 ⌘J", "回收站");
    await ctx.expectText("恢复后回到原来的位置", { timeout: 8000 });
    await ctx.expectText(title, { timeout: 8000 });
    await ctx.screenshot("node-trash");
    await ctx.press(`恢复 ${title}`);
    await ctx.expectGone(`恢复 ${title}`, { timeout: 8000 });
    await ctx.expectText(title, { timeout: 8000 });
    await ctx.key("escape");

    await ctx.menu(`${title} 操作`, "删除");
    await ctx.expectText(`删除「${title}」？`);
    await ctx.press("删除");
    await ctx.menu("更多 ⌘J", "回收站");
    await ctx.expectText(`永久删除 ${title}`, { timeout: 8000 });
    await ctx.press(`永久删除 ${title}`);
    await ctx.press(`确认永久删除 ${title}`, { timeout: 5000 });
    await ctx.expectGone(`永久删除 ${title}`, { timeout: 8000 });
    await ctx.waitForDb(
      "SELECT COUNT(*) AS count FROM node WHERE title = ?",
      [title],
      (rows) => rows[0].count === 0,
      { timeout: 10_000 },
    );
    await ctx.screenshot("node-trash-purged");
    await ctx.key("escape");

    // 清空回收站：按钮在页脚（曾与右上角关闭按钮重叠），需二次确认后整库清除。
    const bulk = ["E2E Trash Bulk A", "E2E Trash Bulk B"];
    for (const title of bulk) {
      await ctx.press("新建内容");
      await ctx.expectText("创建");
      await ctx.fill("名称", title);
      await ctx.press("创建");
      await ctx.expectText(title, { timeout: 10_000 });
      await ctx.menu(`${title} 操作`, "删除");
      await ctx.expectText(`删除「${title}」？`);
      await ctx.press("删除");
      ctx.metrics.dialogs += 2;
    }
    await ctx.menu("更多 ⌘J", "回收站");
    await ctx.expectText(bulk[0], { timeout: 8000 });
    await ctx.screenshot("node-trash-footer");
    await ctx.press("清空回收站");
    await ctx.expectText("确认清空？", { timeout: 5000 });
    await ctx.press("确认清空？");
    await ctx.expectText("回收站为空", { timeout: 10_000 });
    await ctx.waitForDb(
      "SELECT COUNT(*) AS count FROM node WHERE title IN (?, ?)",
      bulk,
      (rows) => rows[0].count === 0,
      { timeout: 10_000 },
    );
    ctx.metrics.dialogs += 1;
    await ctx.key("escape");
    ctx.log("删除进入回收站、恢复回原位置、永久删除与清空回收站均落库。");
  },
};
