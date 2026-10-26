import assert from "node:assert/strict";

/**
 * 表格与流程图：新建后分别复用文档编辑器与画板编辑器。
 * 表格默认 3×3，输入内容须落库；流程图打开即进入画板视图。
 */
export default {
  id: "22-table-flow",
  title: "表格/流程图 · 复用编辑器 · 默认表格 · 内容落库",
  area: "文件树 / 表格与流程图",
  steps: [
    {
      action: "新建表格 E2E Table",
      ui: "新建内容 → 类型「表格」→ 名称 → 创建",
      clicks: 2,
      dialogs: 1,
      typing: 1,
      note: "创建后自动打开表格编辑器，页头标识为「表格」。",
    },
    {
      action: "在首个单元格输入内容",
      ui: "表格正文首个单元格",
      clicks: 1,
      dialogs: 0,
      typing: 1,
      note: "等待自动保存，并核对正文已写入数据库。",
    },
    {
      action: "新建流程图 E2E Flow",
      ui: "新建内容 → 类型「流程图」→ 名称 → 创建",
      clicks: 2,
      dialogs: 1,
      typing: 1,
      note: "创建后自动打开画板视图，页头提供放映与导出。",
    },
    {
      action: "删除流程图与表格",
      ui: "文件树行内 ⋯ → 删除 → 确认",
      clicks: 6,
      dialogs: 2,
      note: "清理测试节点，避免影响后续用例的树结构断言。",
    },
  ],
  complexity: {
    clickTotal: 12,
    dialogs: 4,
    typingFields: 3,
    assessment:
      "表格与流程图直接复用现有文档/画板编辑器，新建仍是“打开弹窗 → 选类型 → 输入名称 → 创建”四步。表格默认给出一张 3×3 空表，打开即可输入；流程图打开后拥有画板全套能力（组件库、附件、放映、导出），没有额外学习成本。",
  },
  async run(ctx) {
    const createNode = async (kind, title) => {
      await ctx.press("新建内容");
      await ctx.expectText("创建");
      await ctx.press(kind, { role: "AXCheckBox", settle: 180 });
      await ctx.fill("名称", title);
      await ctx.press("创建");
      await ctx.expectText(title, { timeout: 10_000 });
      await ctx.expectText(`${title} 操作`, { timeout: 10_000 });
      ctx.metrics.dialogs += 1;
    };

    await createNode("表格", "E2E Table");
    await ctx.expectText("表格正文", { timeout: 15_000 });
    await ctx.expectText("已保存", { timeout: 15_000 });

    const table = ctx.db("SELECT id, type, content FROM node WHERE title = 'E2E Table'")[0];
    assert.equal(table?.type, 4, "E2E Table 应为表格节点");
    const tableDoc = JSON.parse(table.content);
    const rows = tableDoc.content[0]?.content ?? [];
    assert.equal(tableDoc.content[0]?.type, "table", "默认内容应为表格");
    assert.equal(rows.length, 3, `默认表格应有 3 行，实际 ${rows.length}`);
    assert.ok(
      rows.every((row) => (row.content ?? []).length === 3),
      "默认表格每行应有 3 列",
    );

    const editor = (await ctx.find("表格正文")).matches[0];
    if (!editor) throw new Error("找不到表格正文区域");
    await ctx.click(editor.point.x + 48, editor.point.y + 36, "点击表格首个单元格");
    await ctx.paste("表格黑盒内容");
    await ctx.waitForDb(
      "SELECT content FROM node WHERE title = 'E2E Table'",
      [],
      (rows) => rows.length === 1 && rows[0].content.includes("表格黑盒内容"),
      { timeout: 15_000 },
    );
    await ctx.expectText("已保存", { timeout: 15_000 });
    await ctx.screenshot("table-editor");

    await createNode("流程图", "E2E Flow");
    await ctx.expectText("放映画板", { timeout: 15_000 });
    await ctx.expectText("导出", { timeout: 5000 });
    const flow = ctx.db("SELECT type FROM node WHERE title = 'E2E Flow'")[0];
    assert.equal(flow?.type, 5, "E2E Flow 应为流程图节点");
    await ctx.screenshot("flow-editor");

    for (const title of ["E2E Flow", "E2E Table"]) {
      await ctx.menu(`${title} 操作`, "删除");
      await ctx.expectText(`删除「${title}」？`);
      await ctx.press("删除");
    }
    await ctx.waitForDb(
      "SELECT COUNT(*) AS count FROM node WHERE title IN ('E2E Flow', 'E2E Table') AND deleted_at IS NULL",
      [],
      (rows) => rows[0].count === 0,
      { timeout: 10_000 },
    );
    ctx.log("表格默认 3×3、单元格内容落库；流程图复用画板；测试节点已删除。");
  },
};
