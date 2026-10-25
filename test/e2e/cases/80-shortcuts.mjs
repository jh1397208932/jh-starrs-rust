/**
 * 全局快捷键：新建、更多、设置、收藏、保存、侧栏、全局搜索/跳转/放映 mock、关闭标签。
 */
export default {
  id: "80-shortcuts",
  title: "全局快捷键 · 新建/更多/设置/收藏/保存/侧栏/关闭",
  area: "快捷键",
  steps: [
    {
      action: "⌘N 打开新建",
      ui: "全局快捷键；任意主界面",
      clicks: 0,
      dialogs: 1,
      note: "应打开新建弹窗，取消。",
    },
    {
      action: "⌘J 打开更多、Esc 关闭",
      ui: "全局快捷键",
      clicks: 0,
      dialogs: 0,
    },
    {
      action: "⌘, 打开设置并关闭",
      ui: "全局快捷键",
      clicks: 1,
      dialogs: 1,
    },
    {
      action: "⌘D 收藏/取消收藏当前文档",
      ui: "文档页头状态；需先打开 E2E Doc",
      clicks: 1,
      dialogs: 0,
      note: "验证两个方向的 aria-label。",
    },
    {
      action: "⌘S 保存、⌘\\ 切换侧栏",
      ui: "文档正文 / 主布局",
      clicks: 0,
      dialogs: 0,
    },
    {
      action: "⌘⇧F、⌘K、⌘P 触发占位动作",
      ui: "全局快捷键",
      clicks: 0,
      dialogs: 0,
      note: "当前提示「即将推出」，记录而非判失败。",
    },
    {
      action: "⌘W 关闭当前标签",
      ui: "标签栏",
      clicks: 0,
      dialogs: 0,
    },
  ],
  complexity: {
    clickTotal: 2,
    dialogs: 3,
    typingFields: 0,
    assessment:
      "常用操作有快捷键覆盖，且与菜单文案提示一致（⌘N/⌘J/⌘S/⌘D）。⌘⇧F 全局搜索、⌘K 快速跳转、⌘P 放映画板仍是占位动作，按下提示「即将推出」，设置列表也已标注；用户不会误以为功能已可用。⌘W 关闭标签无二次确认，文档有未保存守卫，属合理取舍。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少 E2E Doc");

    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 8000 });

    await ctx.key("cmd+n");
    await ctx.expectText("创建", { timeout: 5000 });
    await ctx.press("取消");
    ctx.metrics.dialogs += 1;

    await ctx.key("cmd+j");
    await ctx.expectText("模板库", { timeout: 5000 });
    await ctx.key("escape");

    await ctx.key("cmd+,");
    await ctx.expectText("外观", { timeout: 5000 });
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    await ctx.key("cmd+d");
    await ctx.expectText("取消收藏 (⌘D)", { timeout: 5000 });
    await ctx.key("cmd+d");
    await ctx.expectText("收藏 (⌘D)", { timeout: 5000 });

    await ctx.key("cmd+s");
    await ctx.expectText("已保存", { timeout: 8000 });

    const sidebarOpen = (await ctx.find("更多 ⌘J")).matches[0];
    if (!sidebarOpen) throw new Error("侧栏更多入口不存在");
    await ctx.key("cmd+\\");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sidebarClosed = (await ctx.find("更多 ⌘J")).matches[0];
    if (!sidebarClosed || sidebarClosed.point.x > sidebarOpen.point.x - 100) {
      throw new Error("⌘\\ 未收起侧栏");
    }
    await ctx.screenshot("shortcuts-sidebar-collapsed");
    await ctx.key("cmd+\\");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sidebarRestored = (await ctx.find("更多 ⌘J")).matches[0];
    if (!sidebarRestored || sidebarRestored.point.x < sidebarOpen.point.x - 100) {
      throw new Error("⌘\\ 未恢复侧栏");
    }

    const mockShortcuts = [
      { combo: "cmd+shift+f", label: "全局搜索" },
      { combo: "cmd+k", label: "快速跳转" },
      { combo: "cmd+p", label: "放映当前画板" },
    ];
    for (const item of mockShortcuts) {
      await ctx.key(item.combo);
      let responded = false;
      try {
        await ctx.expectText(item.label, { timeout: 2500 });
        await ctx.expectText("即将推出", { timeout: 2500 });
        responded = true;
        ctx.log(`${item.combo} → ${item.label} mock toast`);
      } catch {
        responded = false;
      }
      if (!responded) {
        ctx.finding(
          "medium",
          `${item.combo} 没有出现「${item.label}」提示`,
          "该快捷键在源码中注册为 mock 动作，但真实 WKWebView 下未看到 toast；Cmd+Shift+F / Cmd+K / Cmd+P 与 WebView/系统保留键冲突时可能被截获。建议改用非保留组合或在 Tauri 菜单层注册。",
        );
      } else {
        await ctx.expectGone("即将推出", { timeout: 6000 });
      }
    }

    await ctx.key("cmd+w");
    await ctx.expectGone("文档 · E2E Doc", { timeout: 8000 });
    await ctx.screenshot("shortcuts-done");
  },
};
