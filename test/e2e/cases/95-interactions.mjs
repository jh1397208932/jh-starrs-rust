/**
 * 编辑器与画布的交互：slash 菜单建标题、画布绘制/撤销/重做/缩放。
 */
export default {
  id: "95-interactions",
  title: "编辑器 slash 命令 · 画布绘制/撤销/重做/缩放",
  area: "编辑器 / 画板交互",
  steps: [
    {
      action: "新建 E2E Rich 文档并打开",
      ui: "新建内容 → 文档 → 正文",
      clicks: 3,
      dialogs: 1,
      typing: 1,
    },
    {
      action: "正文输入 / 唤起 slash 菜单，选择「标题 H1」",
      ui: "文档正文；slash 菜单",
      clicks: 1,
      dialogs: 0,
      typing: 1,
      note: "选择后输入标题，检查 markdown 出现 # 标题。",
    },
    {
      action: "打开 E2E Board，选择矩形工具并拖拽绘制",
      ui: "Excalidraw 工具条矩形按钮 → 画布",
      clicks: 1,
      dialogs: 0,
      note: "验证 board_scene 元素数增加。",
    },
    {
      action: "⌘Z 撤销、⌘⇧Z 重做",
      ui: "画布 / 全局快捷键",
      clicks: 0,
      dialogs: 0,
      note: "验证元素数往返。",
    },
    {
      action: "放大、重置缩放",
      ui: "画布左下角缩放控件",
      clicks: 2,
      dialogs: 0,
      note: "Excalidraw 仅暴露重置缩放按钮，放大比例未暴露数值。",
    },
  ],
  complexity: {
    clickTotal: 8,
    dialogs: 1,
    typingFields: 2,
    assessment:
      "slash 菜单通过键盘输入 / 触发，选项有标题/列表/表格等；对键盘用户高效，但鼠标用户仍要从工具栏或菜单找。画布绘制/撤销/重做的反馈即时，工具按钮的 aria-label 是中文「矩形」。缩放百分比在 AX 树中不可读，只能通过重置缩放按钮确认控件存在；视觉用户可读，读屏用户难以确认当前比例，建议给缩放显示补 aria-label。",
  },
  async run(ctx) {
    // 新建干净文档用于 slash 菜单，避免正文已有内容影响断言。
    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.press("文档", { role: "AXCheckBox", settle: 180 });
    await ctx.fill("名称", "E2E Rich");
    await ctx.press("创建");
    await ctx.expectText("文档正文", { timeout: 10_000 });
    ctx.metrics.dialogs += 1;

    await ctx.clientClick(584, 287, "点击文档正文区域");
    await ctx.key("/");
    await ctx.expectText("标题 H1", { timeout: 5000 });
    await ctx.press("标题 H1", { role: "AXMenuItem" });
    await ctx.paste("黑盒标题二");
    const meta = await ctx.waitForDb(
      "SELECT markdown, prop FROM doc_block_meta WHERE markdown LIKE '%黑盒标题二%'",
      [],
      (rows) => rows.length >= 1,
      { timeout: 15_000 },
    );
    const markdown = meta[0].markdown;
    if (!markdown.includes("# 黑盒标题二")) throw new Error(`slash 标题未写入 markdown：${markdown}`);
    const prop = JSON.parse(meta[0].prop);
    if (prop.headingCount < 1) throw new Error("文档元数据 headingCount 未更新");
    await ctx.screenshot("editor-slash-heading");

    // 画布交互
    const boardTitle = ctx.shared.boardTitle;
    const node = ctx.db("SELECT id FROM node WHERE title = ?", [boardTitle])[0];
    const before = ctx.db("SELECT element_count FROM board_scene WHERE node_id = ?", [node.id])[0]
      .element_count;
    await ctx.press(boardTitle);
    await ctx.expectText("导出画板", { timeout: 8000 });
    await ctx.press("矩形", { role: "AXRadioButton", settle: 180 });
    await ctx.clientDrag(484, 447, 644, 557, "在画布空白区域绘制矩形");
    const afterDraw = await ctx.waitForDb(
      "SELECT element_count FROM board_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].element_count > before,
      { timeout: 20_000 },
    );
    await ctx.key("cmd+z");
    await ctx.waitForDb(
      "SELECT element_count FROM board_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].element_count === before,
      { timeout: 15_000 },
    );
    await ctx.key("cmd+shift+z");
    await ctx.waitForDb(
      "SELECT element_count FROM board_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].element_count === afterDraw[0].element_count,
      { timeout: 15_000 },
    );
    await ctx.press("放大", { role: "AXButton", settle: 200 });
    await ctx.press("重置缩放", { role: "AXButton", settle: 200 });
    await ctx.screenshot("board-drawn");
    ctx.shared.boardElementCount = afterDraw[0].element_count;
    ctx.log(`画布元素 ${before} → ${afterDraw[0].element_count}（撤销/重做往返）`);
  },
};
