import assert from "node:assert/strict";

/** 文件树基座：创建文件夹/文档/画板，重命名与删除。后续用例复用这三个节点。 */
export default {
  id: "20-tree",
  title: "文件树 · 新建文件夹/文档/画板 · 重命名 · 删除",
  area: "文件树 / 节点生命周期",
  steps: [
    {
      action: "打开「新建内容」",
      ui: "文件树标题右侧 +",
      clicks: 1,
      dialogs: 1,
      note: "新建弹窗提供文件夹/文档/画板/思维导图。",
    },
    {
      action: "新建文件夹 E2E Folder",
      ui: "新建弹窗：类型按钮「文件夹」+ 名称输入 + 创建",
      clicks: 2,
      dialogs: 0,
      typing: 1,
    },
    {
      action: "新建文档 E2E Doc",
      ui: "新建弹窗：类型按钮「文档」+ 名称输入 + 创建",
      clicks: 2,
      dialogs: 0,
      typing: 1,
      note: "创建后自动打开文档页。",
    },
    {
      action: "新建画板 E2E Board",
      ui: "新建弹窗：类型按钮「画板」+ 名称输入 + 创建",
      clicks: 2,
      dialogs: 0,
      typing: 1,
      note: "创建后自动打开画板页。",
    },
    {
      action: "重命名文件夹",
      ui: "文件树行内 ⋯ → 重命名 → 名称输入 → 保存",
      clicks: 3,
      dialogs: 1,
      typing: 1,
    },
    {
      action: "新建并删除临时文档 E2E Delete",
      ui: "新建内容 → 文档 → 行内 ⋯ → 删除 → 确认",
      clicks: 5,
      dialogs: 2,
      typing: 1,
      note: "验证删除确认弹窗与级联结果。",
    },
  ],
  complexity: {
    clickTotal: 15,
    dialogs: 4,
    typingFields: 4,
    assessment:
      "新建内容是两步选择（打开弹窗 + 选类型）再输入名称、点创建；对高频“新建文档”而言偏重。侧栏已有「新建」快捷动作与 ⌘N，但新建画板/文件夹仍必须走弹窗。行内操作 ⋯ 藏在 hover 后，键盘/读屏依赖 aria-label；自动化通过 AX 标签可直达。删除有二次确认，符合不可逆操作预期。",
  },
  async run(ctx) {
    const createNode = async (kind, title) => {
      await ctx.press("新建内容");
      await ctx.expectText("创建");
      await ctx.press(kind, { role: "AXCheckBox", settle: 180 });
      await ctx.fill("名称", title);
      await ctx.press("创建");
      await ctx.expectText(title, { timeout: 10_000 });
      // expectText 可能命中弹窗输入框；等树行操作出现才算创建完成。
      await ctx.expectText(`${title} 操作`, { timeout: 10_000 });
      ctx.metrics.dialogs += 1;
    };

    await createNode("文件夹", "E2E Folder");
    await createNode("文档", "E2E Doc");
    await createNode("画板", "E2E Board");
    await ctx.screenshot("tree-created");

    // 重命名文件夹
    await ctx.menu("E2E Folder 操作", "重命名");
    await ctx.expectText("重命名");
    await ctx.fill("E2E Folder", "E2E Folder Renamed");
    await ctx.press("保存");
    await ctx.expectText("E2E Folder Renamed", { timeout: 8000 });

    // 删除临时文档
    await createNode("文档", "E2E Delete");
    await ctx.menu("E2E Delete 操作", "删除");
    await ctx.expectText("删除「E2E Delete」？");
    await ctx.press("删除");
    await new Promise((resolve) => setTimeout(resolve, 800));

    const rows = ctx.db(
      "SELECT title, type, deleted_at FROM node WHERE title IN ('E2E Folder Renamed','E2E Doc','E2E Board','E2E Delete') ORDER BY title",
    );
    const byTitle = Object.fromEntries(rows.map((row) => [row.title, row.type]));
    assert.equal(byTitle["E2E Folder Renamed"], 1);
    assert.equal(byTitle["E2E Doc"], 2);
    assert.equal(byTitle["E2E Board"], 3);
    const removed = rows.find((row) => row.title === "E2E Delete");
    assert.ok(removed, "临时文档应保留在回收站");
    assert.ok(removed.deleted_at, "临时文档应标记为已删除");

    ctx.shared.folderTitle = "E2E Folder Renamed";
    ctx.shared.docTitle = "E2E Doc";
    ctx.shared.boardTitle = "E2E Board";
  },
};
