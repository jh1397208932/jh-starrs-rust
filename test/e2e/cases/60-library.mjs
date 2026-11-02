import assert from "node:assert/strict";

/** 组件库：预设启停、导入社区库。 */
export default {
  id: "60-library",
  title: "组件库 · 预设启停 · 导入 .excalidrawlib",
  area: "组件库",
  steps: [
    {
      action: "更多 → 组件库",
      ui: "侧栏底部更多菜单 → 组件库管理弹窗",
      clicks: 3,
      dialogs: 1,
      note: "弹窗列出预设库、许可、组件数与开关。",
    },
    {
      action: "停用再启用「云架构模式」",
      ui: "列表第二行右侧 Switch",
      clicks: 2,
      dialogs: 0,
      note: "验证 board_library.enabled 持久化。",
    },
    {
      action: "导入 sample.excalidrawlib",
      ui: "弹窗右上「导入组件库」→ 系统文件面板",
      clicks: 2,
      dialogs: 1,
      note: "导入后应新增 source_type=import 的库。",
    },
    {
      action: "关闭组件库管理",
      ui: "弹窗右上关闭",
      clicks: 1,
      dialogs: 0,
    },
    {
      action: "画板面板「我的组件」查看导入库",
      ui: "画板右缘组件 → 我的组件",
      clicks: 3,
      dialogs: 0,
      note: "导入库按库名分组出现在我的组件，不与内置组件重复。",
    },
  ],
  complexity: {
    clickTotal: 11,
    dialogs: 2,
    typingFields: 0,
    assessment:
      "管理入口在更多菜单内；列表把预设与导入库放在一起，用徽标区分，开关一键启停。导入必须走系统文件面板，路径较深时操作成本主要在文件导航，而不是应用本身。列表无搜索/分组，库多时需要滚动；当前 8 个预设在 640px 弹窗里已接近一屏。",
  },
  async run(ctx) {
    await ctx.menu("更多 ⌘J", "组件库");
    await ctx.expectText("导入组件库", { timeout: 8000 });

    const before = ctx.db("SELECT enabled FROM board_library WHERE name = '云架构模式'")[0];
    assert.ok(before, "云架构模式预设不存在");
    const target = before.enabled === 1 ? 0 : 1;
    await ctx.press("云架构模式", { role: "AXCheckBox" });
    await ctx.waitForDb(
      "SELECT enabled FROM board_library WHERE name = '云架构模式'",
      [],
      (rows) => rows.length === 1 && rows[0].enabled === target,
    );
    await ctx.screenshot("library-toggled");
    await ctx.press("云架构模式", { role: "AXCheckBox" });
    await ctx.waitForDb(
      "SELECT enabled FROM board_library WHERE name = '云架构模式'",
      [],
      (rows) => rows.length === 1 && rows[0].enabled === before.enabled,
    );

    await ctx.press("导入组件库");
    await ctx.nativePath(ctx.fixture("sample.excalidrawlib"), { button: "Open" });
    ctx.metrics.dialogs += 1;
    const imported = await ctx.waitForDb(
      "SELECT name, source_type, item_count FROM board_library WHERE source_type = 'import' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1,
      { timeout: 20_000 },
    );
    assert.equal(imported[0].source_type, "import");
    assert.ok(imported[0].item_count > 0, "导入库组件数为 0");
    ctx.shared.importedLibrary = imported[0].name;
    await ctx.screenshot("library-imported");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;
    ctx.log(`导入库：${imported[0].name}，${imported[0].item_count} 个组件`);

    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) {
      ctx.log("跳过「我的组件」：本运行未创建画板");
      return;
    }
    await ctx.press(boardTitle);
    await ctx.press("展开组件库");
    await ctx.press("我的组件");
    await ctx.expectText(imported[0].name, { timeout: 8000 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await ctx.screenshot("library-mine");
    await ctx.press("收起组件库");
  },
};
