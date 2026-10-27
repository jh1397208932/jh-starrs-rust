/**
 * 主界面壳层：更多菜单、工作区切换浮层、设置入口。
 * 验证已实现入口可达，并记录标注为「即将推出」的菜单项。
 */
export default {
  id: "10-shell",
  title: "侧栏「更多」、工作区切换与设置入口",
  area: "侧栏 / 导航",
  steps: [
    {
      action: "打开左下角「更多」",
      ui: "侧栏底部，⌘J 提示",
      clicks: 1,
      dialogs: 0,
      note: "菜单向上锚定，包含设置、模板库、组件库、全部导出、导入、备份。",
    },
    {
      action: "点击「模板库」",
      ui: "更多菜单第二项",
      clicks: 1,
      dialogs: 1,
      note: "打开模板库弹窗，关闭。",
    },
    {
      action: "点击「备份与恢复」",
      ui: "更多菜单最后一项",
      clicks: 1,
      dialogs: 1,
      note: "打开备份/恢复弹窗，关闭。",
    },
    {
      action: "打开左上角工作区切换浮层",
      ui: "侧栏顶部工作区名按钮",
      clicks: 1,
      dialogs: 0,
      note: "含工作区、知识库、新建/打开/管理入口。",
    },
    {
      action: "从更多菜单打开设置并关闭",
      ui: "更多 → 设置；弹窗右上关闭",
      clicks: 3,
      dialogs: 1,
      note: "设置包含 通用/外观/快捷键/存储/关于。",
    },
  ],
  complexity: {
    clickTotal: 7,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "主入口集中在侧栏底部，一次打开即可看到全部全局动作。「模板库」与「备份与恢复」均已接入真实弹窗；设置与工作区管理需要两次以上点击，符合低频配置类操作。",
  },
  async run(ctx) {
    await ctx.expectText("默认知识库");

    await ctx.menu("更多 ⌘J", "模板库");
    await ctx.expectText("另存为模板");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;
    await ctx.screenshot("shell-template-library");

    await ctx.menu("更多 ⌘J", "备份与恢复");
    await ctx.expectText("备份当前工作区");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    await ctx.press("切换工作区");
    await ctx.expectText("新建工作区");
    await ctx.expectText("打开已有工作区…");
    await ctx.expectText("新建知识库");
    await ctx.expectText("管理知识库");
    await ctx.expectText("管理工作区");
    await ctx.screenshot("shell-workspace-switcher");
    await ctx.key("escape");

    await ctx.menu("更多 ⌘J", "设置");
    await ctx.expectText("通用");
    await ctx.expectText("外观");
    await ctx.expectText("快捷键");
    await ctx.expectText("存储");
    await ctx.expectText("关于");
    await ctx.screenshot("shell-settings");
    await ctx.press("关闭");
    ctx.log("模板库/备份与恢复弹窗可达；其余入口可达。");
  },
};
