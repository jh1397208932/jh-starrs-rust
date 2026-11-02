/**
 * 设置：通用语言默认值、外观主题、存储只统计与清理、快捷键不再报跨作用域重复、关于鸣谢与开源清单弹窗。
 * 附件上传已移出设置（改由左侧树「新建」承担），这里顺带验证那条新路径。
 */
export default {
  id: "50-settings",
  title: "设置 · 语言默认 · 明暗主题 · 存储统计与清理 · 关于鸣谢与开源清单",
  area: "设置 / 存储 / 关于",
  steps: [
    {
      action: "更多 → 设置 → 通用：界面语言显示当前值",
      ui: "设置弹窗「通用」→ 界面语言下拉",
      clicks: 3,
      dialogs: 1,
      note: "回归用例：动效改造后 Radix Content 不再常驻，触发器曾显示为空白。",
    },
    {
      action: "外观：切换深色 → 浅色",
      ui: "外观页明暗模式卡片",
      clicks: 2,
      dialogs: 0,
      note: "验证 global settings 写入并恢复浅色。",
    },
    {
      action: "存储：只看分类统计，无上传与附件列表",
      ui: "设置「存储」→ 占用统计 + 立即清理 + 保留时间",
      clicks: 3,
      dialogs: 0,
      note: "上传/搜索/附件列表已下线；清理需二次确认且只碰无效数据。",
    },
    {
      action: "快捷键：不再提示跨作用域重复",
      ui: "设置「快捷键」应用分组",
      clicks: 1,
      dialogs: 0,
      note: "同一时刻光标只在一个标签页，tab 内键位不算冲突。",
    },
    {
      action: "关于：查看开源项目清单",
      ui: "设置「关于」→ 鸣谢 → 查看开源项目清单 → 弹窗",
      clicks: 2,
      dialogs: 1,
      note: "弹窗只列直接引用的项目，条目可跳转，末尾注明上游项目。",
    },
    {
      action: "树「新建」弹窗内上传附件",
      ui: "文件树 → 新建内容 → 上传附件 → 系统文件面板",
      clicks: 2,
      dialogs: 1,
      note: "附件是树里的一等节点，管理入口跟着树走。",
    },
  ],
  complexity: {
    clickTotal: 13,
    dialogs: 2,
    typingFields: 0,
    assessment:
      "设置里的存储只剩统计与一次带确认的清理，附件的上传/预览/删除回到文件树同一处；关于页用一句鸣谢 + 开源清单弹窗，默认不打扰。",
  },
  async run(ctx) {
    await ctx.menu("更多 ⌘J", "设置");

    await ctx.press("通用", { role: "AXRadioButton" });
    await ctx.expectText("界面语言", { timeout: 8000 });
    await ctx.expectText("简体中文", { timeout: 8000 });
    await ctx.screenshot("settings-general-language");

    await ctx.press("外观", { role: "AXRadioButton" });
    await ctx.expectText("主题", { timeout: 5000 });
    await ctx.press("深色", { role: "AXCheckBox" });
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'appearance.mode'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "dark",
    );
    await ctx.screenshot("settings-dark");
    await ctx.press("浅色", { role: "AXCheckBox" });
    await ctx.waitForGlobalDb(
      "SELECT value FROM settings WHERE key = 'appearance.mode'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "light",
    );

    await ctx.press("存储", { role: "AXRadioButton" });
    await ctx.expectText("占用统计", { timeout: 10_000 });
    await ctx.expectText("工作区总大小", { timeout: 8000 });
    await ctx.expectText("附件总大小", { timeout: 8000 });
    await ctx.expectText("保留时间", { timeout: 8000 });
    await ctx.expectNoText("搜索附件");
    await ctx.expectNoText("附件列表");
    await ctx.screenshot("settings-storage-stats");

    await ctx.press("开始清理");
    await ctx.expectText("确认清理？", { timeout: 5000 });
    await ctx.press("确认清理？");
    // 结果提示只留 3 秒，且「清理」二字在页面标题「立即清理」上常驻，
    // 所以按两条真实文案并行轮询，谁先出现算谁；两条都没出现才是失败。
    const notice = await ctx.waitForAnyText(["已清理", "没有需要清理的数据"], {
      timeout: 20_000,
    });
    ctx.log(`清理结果提示命中：${notice}`);
    await ctx.screenshot("settings-storage-cleaned");

    await ctx.press("快捷键", { role: "AXRadioButton" });
    await ctx.expectText("更多菜单", { timeout: 5000 });
    await ctx.expectNoText("当前作用域优先");

    await ctx.press("关于", { role: "AXRadioButton" });
    await ctx.expectText("本地工作区版", { timeout: 5000 });
    await ctx.expectText("感谢每一位作者与贡献者", { timeout: 5000 });
    await ctx.press("查看开源项目清单");
    await ctx.expectText("星屿直接使用的开源项目", { timeout: 5000 });
    await ctx.expectText("rusqlite", { timeout: 5000 });
    await ctx.expectText("Plus Jakarta Sans", { timeout: 5000 });
    await ctx.expectText("以及这些项目的上游项目", { timeout: 5000 });
    await ctx.screenshot("settings-about-credits");
    await ctx.key("escape");
    await ctx.expectText("查看开源项目清单", { timeout: 5000 });
    await ctx.press("完成");
    ctx.metrics.dialogs += 1;
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });

    await ctx.press("新建内容");
    await ctx.expectText("创建", { timeout: 8000 });
    await ctx.screenshot("node-create-with-upload");
    await ctx.press("取消");
    ctx.metrics.dialogs += 1;
    // 上传入口在文件树工具栏：点开先选「附件 / 文件夹」，这里走选附件。
    await ctx.menu("上传附件", "选择附件");
    await ctx.nativePath(ctx.fixture("pixel.png"), { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT name, status FROM attachment WHERE name = 'pixel.png' AND status = 'active'",
      [],
      (rows) => rows.length >= 1,
      { timeout: 20_000 },
    );
    ctx.shared.attachmentName = "pixel.png";
  },
};
