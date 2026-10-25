/** 快捷键作用域：编辑器加粗与画板矩形工具的自定义键位。 */
export default {
  id: "87-shortcut-scopes",
  title: "快捷键作用域 · 编辑器加粗 · 画板矩形工具",
  area: "设置 / 快捷键 / 编辑器 / 画板",
  steps: [
    {
      action: "录制编辑器加粗 ⌘⌥B 与画板矩形 ⌘⌥R",
      ui: "设置 → 快捷键 → 编辑器/画板分组",
      clicks: 4,
      dialogs: 1,
      note: "两条配置分别写入 shortcuts.config。",
    },
    {
      action: "文档全选后按 ⌘⌥B",
      ui: "E2E Doc 正文",
      clicks: 1,
      dialogs: 0,
      note: "保存后 markdown 必须出现粗体标记。",
    },
    {
      action: "打开 E2E Board，按 ⌘⌥R 后拖拽",
      ui: "画板画布",
      clicks: 1,
      dialogs: 0,
      note: "矩形工具被自定义键位选中，元素数增加。",
    },
    {
      action: "恢复默认快捷键",
      ui: "设置 → 快捷键",
      clicks: 2,
      dialogs: 1,
      note: "避免影响后续用例。",
    },
  ],
  complexity: {
    clickTotal: 8,
    dialogs: 2,
    typingFields: 0,
    assessment:
      "编辑器与画板各自有独立作用域，录制后无需重开编辑器或画板即可生效；画板原生键位仍由 Excalidraw 处理，自定义动作在捕获阶段接管。",
  },
  async run(ctx) {
    const doc = ctx.db("SELECT id FROM node WHERE title = 'E2E Doc' ORDER BY create_time LIMIT 1")[0];
    const board = ctx.db("SELECT id FROM node WHERE title = 'E2E Board' ORDER BY create_time LIMIT 1")[0];
    if (!doc || !board) throw new Error("缺少 E2E Doc 或 E2E Board");

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.press("录制 加粗");
    await ctx.key("cmd+alt+b");
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'shortcuts.config'",
      [],
      (rows) => rows.length === 1 && rows[0].value.includes('"editor.bold":"Mod+Alt+B"'),
      { timeout: 10_000 },
    );
    await ctx.press("录制 矩形工具");
    await ctx.key("cmd+alt+r");
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'shortcuts.config'",
      [],
      (rows) => rows.length === 1 && rows[0].value.includes('"board.rectangle":"Mod+Alt+R"'),
      { timeout: 10_000 },
    );
    await ctx.press("关闭");

    await ctx.press("E2E Doc");
    await ctx.expectText("文档正文", { timeout: 8000 });
    await ctx.clientClick(584, 287, "点击文档正文");
    await ctx.key("cmd+a");
    await ctx.key("cmd+alt+b");
    await ctx.key("cmd+s");
    await ctx.waitForDb(
      "SELECT markdown FROM doc_block_meta WHERE id = ?",
      [doc.id],
      (rows) => rows.length === 1 && rows[0].markdown.includes("**"),
      { timeout: 15_000 },
    );

    const before = ctx.db("SELECT element_count FROM board_scene WHERE node_id = ?", [board.id])[0]
      ?.element_count ?? 0;
    await ctx.press("E2E Board");
    await ctx.expectText("导出画板", { timeout: 8000 });
    await ctx.clientClick(500, 420, "聚焦画布");
    await ctx.key("cmd+alt+r");
    await ctx.clientDrag(484, 447, 644, 557, "用自定义键位选择矩形后拖拽");
    await ctx.waitForDb(
      "SELECT element_count FROM board_scene WHERE node_id = ?",
      [board.id],
      (rows) => rows.length === 1 && rows[0].element_count > before,
      { timeout: 20_000 },
    );

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.press("恢复默认");
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'shortcuts.config'",
      [],
      (rows) =>
        rows.length === 1 &&
        rows[0].value.includes('"editor.bold":"Mod+B"') &&
        rows[0].value.includes('"board.rectangle":"R"'),
      { timeout: 10_000 },
    );
    await ctx.press("关闭");
    await ctx.screenshot("shortcut-scopes");
    ctx.log("编辑器/画板自定义键位均生效，并已恢复默认");
  },
};
