import assert from "node:assert/strict";

/**
 * 文档内嵌画板图：只展示已导出的 PNG；顺带验证查找浮层与草稿不误报。
 * 依赖 40-board 创建的 E2E Board。
 */
export default {
  id: "97b-doc-embed",
  title: "文档内嵌画板图 · 查找浮层 · 草稿不误报",
  area: "文档编辑",
  steps: [
    {
      action: "打开 E2E Board，等预览落库",
      ui: "左侧文件树行 → 画板保存胶囊",
      clicks: 1,
      dialogs: 0,
      note: "预览由画板保存静止后导出，文档端不渲染源场景。",
    },
    {
      action: "新建文档并输入长正文",
      ui: "新建内容 → 文档 → 正文",
      clicks: 3,
      dialogs: 1,
      typing: 1,
      note: "正文底部留「深层关键字」，用于验证查找跳转。",
    },
    {
      action: "Slash → 画板图 → 选择 E2E Board",
      ui: "编辑器 Slash 菜单 → 选择弹窗 → 内嵌卡片",
      clicks: 3,
      dialogs: 1,
      note: "块里只存源节点 id，不复制图片字节。",
    },
    {
      action: "⌘F 查找「深层关键字」",
      ui: "编辑区右上角查找浮层",
      clicks: 0,
      dialogs: 0,
      typing: 1,
      note: "输入即高亮并滚动到命中处。",
    },
    {
      action: "编辑后保存完成，关标签再打开",
      ui: "标签关闭 → 树行重开",
      clicks: 2,
      dialogs: 0,
      note: "正常保存后不得再弹「检测到未保存的草稿」。",
    },
  ],
  complexity: {
    clickTotal: 9,
    dialogs: 2,
    typingFields: 3,
    assessment:
      "内嵌画板图是三步：Slash 打开菜单、选「画板图」、在选择器里点源节点；块插入后只读已存 PNG，源更新需等下次保存静止后重新导出。查找浮层输入即跳转，符合浏览器查找习惯。",
  },
  async run(ctx) {
    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) throw new Error("缺少 E2E Board");

    await ctx.press(boardTitle);
    await ctx.expectText("导出画板", { timeout: 15_000 });
    const boardRow = ctx.db("SELECT id FROM node WHERE title = ?", [boardTitle])[0];
    assert.ok(boardRow, "画板节点应存在");
    await ctx.waitForDb(
      `SELECT p.object_id, p.width, p.height
       FROM node_preview p JOIN node n ON n.id = p.node_id
       WHERE n.title = ?`,
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].width > 0 && rows[0].height > 0,
      { timeout: 25_000 },
    );
    ctx.log(`画板预览已落库 node=${boardRow.id}`);

    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.press("文档", { role: "AXCheckBox", settle: 180 });
    await ctx.fill("名称", "E2E 内嵌文档");
    await ctx.press("创建");
    await ctx.expectText("文档正文", { timeout: 15_000 });
    ctx.metrics.dialogs += 1;

    const body = ["深层关键字", ...Array.from({ length: 40 }, (_, index) => `占位段落 ${index + 1}`)].join(
      "\n",
    );
    await ctx.fill("文档正文", body);
    await ctx.press("文档正文");
    await ctx.paste("\n/");
    await ctx.expectText("画板图", { timeout: 5000 });
    await ctx.press("画板图");
    await ctx.expectText("插入画板图", { timeout: 5000 });
    await ctx.press(`插入${boardTitle}`);
    await ctx.expectText("预览 · 源最近更新", { timeout: 15_000 });
    await ctx.screenshot("doc-embed-board");
    ctx.metrics.dialogs += 1;

    const docRows = await ctx.waitForDb(
      "SELECT content FROM node WHERE title = ?",
      ["E2E 内嵌文档"],
      (rows) => rows.length === 1 && rows[0].content.includes("boardEmbed"),
      { timeout: 15_000 },
    );
    const document = JSON.parse(docRows[0].content);
    const embed = document.content.find((block) => block.type === "boardEmbed");
    assert.ok(embed, "文档应包含 boardEmbed 块");
    assert.equal(embed.attrs.nodeId, boardRow.id, "块里应存源节点 id");
    assert.ok(!docRows[0].content.includes("data:image/png"), "文档不得内嵌 PNG 字节");

    const previewAttachment = ctx.db(
      "SELECT COUNT(*) AS c FROM attachment WHERE logical_path = '__preview' AND status = 'active'",
    );
    assert.ok(previewAttachment[0].c >= 1, "预览图应存在于附件对象库");

    await ctx.key("cmd+f");
    await ctx.expectText("文档内查找", { timeout: 5000 });
    await ctx.fill("查找内容", "深层关键字");
    await ctx.expectText("1 / 1", { timeout: 5000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const keywordHits = (await ctx.find("深层关键字")).matches ?? [];
    const inDoc = keywordHits.filter(
      (hit) => hit.role === "AXStaticText" && hit.point.y > 100 && hit.point.y < 1200,
    );
    if (inDoc.length === 0) throw new Error("查找命中没有滚动到视口");
    await ctx.screenshot("doc-find-float");
    await ctx.key("escape");

    // 正常保存后停 2.5s：旧实现会在这之后留一份更晚的草稿，重开必弹提示。
    await ctx.press("文档正文");
    await ctx.paste(" 草稿测试");
    await ctx.expectText("已保存", { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await ctx.key("cmd+w");
    await ctx.press("E2E 内嵌文档");
    await ctx.expectText("文档正文", { timeout: 10_000 });
    await ctx.expectGone("检测到未保存的草稿", { timeout: 2000 });
    await ctx.screenshot("doc-reopened-no-draft");
  },
};
