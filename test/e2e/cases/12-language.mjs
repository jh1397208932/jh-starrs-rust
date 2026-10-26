/**
 * 界面语言：中文 → English → 中文，验证设置、侧栏与更多菜单即时切换。
 */
export default {
  id: "12-language",
  title: "界面语言 · 中文 / English 即时切换",
  area: "设置 / 国际化",
  steps: [
    {
      action: "设置 → 通用 → 界面语言选择 English",
      ui: "更多 → 设置 → 通用 → 语言下拉",
      clicks: 3,
      dialogs: 1,
      typing: 0,
      note: "整个界面立即切换为英文。",
    },
    {
      action: "检查侧栏与更多菜单英文",
      ui: "侧栏快捷按钮、更多菜单",
      clicks: 1,
      dialogs: 1,
      note: "More / Settings / Templates / Library 等均为英文。",
    },
    {
      action: "切回简体中文",
      ui: "Settings → General → Language",
      clicks: 3,
      dialogs: 1,
      note: "恢复中文，避免影响后续用例。",
    },
  ],
  complexity: {
    clickTotal: 7,
    dialogs: 3,
    typingFields: 0,
    assessment:
      "语言入口在设置 → 通用，切换即时生效并持久化；侧栏、菜单、设置与对话框共享同一套文案。切换回中文不丢当前工作区与打开内容。",
  },
  async run(ctx) {
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.expectText("通用", { timeout: 5000 });
    await ctx.press("通用");
    await ctx.press("界面语言", { role: "AXComboBox", settle: 320 });
    await ctx.press("English", { settle: 320 });
    await ctx.expectText("Settings", { timeout: 8000 });
    await ctx.expectText("Appearance", { timeout: 5000 });
    await ctx.expectText("Language", { timeout: 5000 });
    await ctx.screenshot("language-en-settings");
    await ctx.press("Done");
    await ctx.expectText("More ⌘J", { timeout: 8000 });

    await ctx.menu("More ⌘J", "Settings");
    await ctx.expectText("General", { timeout: 5000 });
    await ctx.press("General");
    await ctx.press("Language", { role: "AXComboBox", settle: 320 });
    await ctx.press("简体中文", { settle: 320 });
    await ctx.expectText("设置", { timeout: 8000 });
    await ctx.press("完成");
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });
    ctx.log("中文 → English → 中文切换与持久化生效。");
  },
};
