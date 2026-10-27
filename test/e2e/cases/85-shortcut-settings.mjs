/** 快捷键：总开关、录制改键、冲突与持久化。 */
export default {
  id: "85-shortcut-settings",
  title: "快捷键设置 · 总开关 · 录制 · 冲突 · 持久化",
  area: "设置 / 快捷键",
  steps: [
    {
      action: "设置 → 快捷键，关闭总开关",
      ui: "更多 → 设置 → 快捷键顶部 Switch",
      clicks: 3,
      dialogs: 1,
      note: "关闭后 ⌘N 不再打开新建弹窗。",
    },
    {
      action: "重新启用并录制新组合 ⌘⇧N",
      ui: "新建行录制按钮 → 按下组合键",
      clicks: 2,
      dialogs: 0,
      note: "配置写入全局 settings，旧组合失效、新组合生效。",
    },
    {
      action: "录制冲突组合 ⌘J 并取消",
      ui: "新建行录制按钮 → 按下 ⌘J",
      clicks: 1,
      dialogs: 0,
      note: "与「更多菜单」同作用域冲突，应拒绝保存。",
    },
    {
      action: "恢复默认并验证 ⌘N",
      ui: "快捷键页「恢复默认」",
      clicks: 1,
      dialogs: 0,
      note: "配置回到默认并继续持久化。",
    },
  ],
  complexity: {
    clickTotal: 7,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "总开关在快捷键页顶部，一眼可见；录制直接按组合键，冲突有明确提示。录制必须保证应用快捷键不抢按键，本轮用真实 WKWebView 验证。",
  },
  async run(ctx) {
    const nodeCount = () =>
      ctx.db("SELECT COUNT(*) AS count FROM node")[0].count;
    const appDialogVisible = async () => (await ctx.find("创建")).count > 0;

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.expectText("启用快捷键", { timeout: 8000 });
    await ctx.press("启用快捷键", { role: "AXCheckBox", settle: 250 });
    await ctx.press("关闭");

    const before = nodeCount();
    await ctx.key("cmd+n");
    await new Promise((resolve) => setTimeout(resolve, 800));
    if ((await appDialogVisible()) || nodeCount() !== before) {
      ctx.finding("high", "关闭总开关后 ⌘N 仍触发", "快捷键总开关未拦截应用动作。");
      await ctx.press("取消");
    } else {
      ctx.log("关闭总开关后 ⌘N 不再触发新建");
    }

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.press("启用快捷键", { role: "AXCheckBox", settle: 250 });
    await ctx.press("录制 新建");
    await ctx.key("cmd+shift+n");
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'shortcuts.config'",
      [],
      (rows) => rows.length === 1 && rows[0].value.includes('"app.newNode":"Mod+Shift+N"'),
      { timeout: 10_000 },
    );
    await ctx.press("关闭");

    const beforeNew = nodeCount();
    await ctx.key("cmd+n");
    await new Promise((resolve) => setTimeout(resolve, 700));
    if ((await appDialogVisible()) || nodeCount() !== beforeNew) {
      ctx.finding("high", "旧组合 ⌘N 在改键后仍触发", "录制新组合后旧键未失效。");
      await ctx.press("取消");
    }
    await ctx.key("cmd+shift+n");
    await ctx.expectText("创建", { timeout: 8000 });
    await ctx.press("取消");
    ctx.log("新组合 ⌘⇧N 生效，旧组合失效");

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.press("录制 新建");
    await ctx.key("cmd+j");
    await ctx.expectText("与「更多菜单」冲突", { timeout: 8000 });
    await ctx.key("escape");
    await ctx.press("恢复默认");
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'shortcuts.config'",
      [],
      (rows) => rows.length === 1 && rows[0].value.includes('"app.newNode":"Mod+N"'),
      { timeout: 10_000 },
    );
    await ctx.press("关闭");

    await ctx.key("cmd+n");
    await ctx.expectText("创建", { timeout: 8000 });
    await ctx.press("取消");
    await ctx.screenshot("shortcut-settings");
    ctx.log("快捷键总开关、录制、冲突与持久化均完成");
  },
};
