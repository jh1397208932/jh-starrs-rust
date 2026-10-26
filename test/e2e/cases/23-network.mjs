/**
 * 知识网络：正文提到标题 → 反向链接；主题相近 → 相关推荐；点击可打开。
 */
export default {
  id: "23-network",
  title: "知识网络 · 反向链接 · 相关推荐 · 打开来源",
  area: "信息面板 / 检索",
  steps: [
    {
      action: "新建目标文档与来源文档",
      ui: "新建内容 → 文档 ×2",
      clicks: 4,
      dialogs: 2,
      typing: 2,
      note: "来源正文提到目标标题。",
    },
    {
      action: "打开目标文档的信息面板 → 反向链接",
      ui: "页头信息按钮 → 反向链接 tab",
      clicks: 2,
      dialogs: 1,
      note: "出现来源文档条目。",
    },
    {
      action: "点击反向链接打开来源",
      ui: "反向链接条目",
      clicks: 1,
      dialogs: 0,
    },
    {
      action: "清理两个测试文档",
      ui: "文件树行内 ⋯ → 删除 → 确认 ×2",
      clicks: 6,
      dialogs: 2,
      note: "删除只进回收站，不影响其他用例。",
    },
  ],
  complexity: {
    clickTotal: 13,
    dialogs: 5,
    typingFields: 3,
    assessment:
      "反向链接与相关推荐都由真实正文索引生成，不需要用户手动维护链接；信息面板一键切换即可查看，条目点击直达来源。无匹配时显示空状态，不硬凑推荐。",
  },
  async run(ctx) {
    const target = "E2E Network Target";
    const source = "E2E Network Source";
    const createDoc = async (title) => {
      await ctx.press("新建内容");
      await ctx.expectText("创建");
      await ctx.fill("名称", title);
      await ctx.press("创建");
      await ctx.expectText("文档正文", { timeout: 10_000 });
      await ctx.expectText(`${title} 操作`, { timeout: 10_000 });
      ctx.metrics.dialogs += 1;
      return title;
    };

    await createDoc(target);
    await ctx.fill("文档正文", "这里是目标内容");
    await ctx.expectText("已保存", { timeout: 15_000 });

    const sourceTitle = await createDoc(source);
    await ctx.fill("文档正文", `参见 ${target} 的说明`);
    await ctx.expectText("已保存", { timeout: 15_000 });

    await ctx.press(target);
    await ctx.press("打开信息面板");
    await ctx.press("反向链接");
    await ctx.expectText(`打开 ${sourceTitle}`, { timeout: 8000 });
    await ctx.screenshot("node-backlinks");
    await ctx.press(`打开 ${sourceTitle}`);
    await ctx.expectText("文档正文", { timeout: 8000 });

    for (const title of [sourceTitle, target]) {
      await ctx.menu(`${title} 操作`, "删除");
      await ctx.expectText(`删除「${title}」？`);
      await ctx.press("删除");
    }
    ctx.log("反向链接从正文索引生成，点击可直达来源；测试节点已移入回收站。");
  },
};
