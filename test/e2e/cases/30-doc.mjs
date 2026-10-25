import fs from "node:fs";
import path from "node:path";

/**
 * 文档编辑与导出：正文输入、自动保存、收藏、信息面板、四格式导出。
 * 依赖 20-tree 创建的 E2E Doc。
 */
export default {
  id: "30-doc",
  title: "文档 · 写作自动保存 · 收藏/信息面板 · 四格式导出",
  area: "文档编辑器",
  steps: [
    {
      action: "打开 E2E Doc",
      ui: "左侧文件树行",
      clicks: 1,
      dialogs: 0,
      note: "文档页头与编辑器加载。",
    },
    {
      action: "在正文输入两段文本",
      ui: "文档编辑器正文区",
      clicks: 1,
      dialogs: 0,
      typing: 1,
      note: "输入后等待自动保存胶囊变为「已保存」。",
    },
    {
      action: "收藏 / 取消收藏",
      ui: "文档页头星标按钮",
      clicks: 2,
      dialogs: 0,
      note: "用 aria-label 验证状态切换。",
    },
    {
      action: "打开信息面板",
      ui: "文档页头信息按钮",
      clicks: 1,
      dialogs: 0,
      note: "检查新建时间字段；再关闭。",
    },
    {
      action: "导出 Markdown/HTML/Word/PDF",
      ui: "文档页头导出按钮 → 导出弹窗 → 系统保存面板",
      clicks: 12,
      dialogs: 4,
      typing: 0,
      note: "每种格式各一次保存对话框；Word 文件复用为后续导入样例。",
    },
  ],
  complexity: {
    clickTotal: 17,
    dialogs: 4,
    typingFields: 1,
    assessment:
      "写作主路径首屏即可输入，自动保存无需用户点击。导出动作是“页头按钮 → 选格式 → 导出 → 系统保存”四步，四格式分别导出时重复度较高；建议后续增加“最近使用的导出格式/一键导出”但当前不阻塞。收藏与信息面板均为一键开合，信息面板字段偏少但仍能确认创建时间。",
  },
  async run(ctx) {
    const docTitle = ctx.shared.docTitle;
    if (!docTitle) throw new Error("缺少前置用例创建的文档标题");

    await ctx.press(docTitle);
    await ctx.expectText("文档正文", { timeout: 15_000 });
    await ctx.expectText("已保存", { timeout: 15_000 });

    await ctx.fill("文档正文", "黑盒测试正文\n\n第二段内容");
    await ctx.expectText("黑盒测试正文");
    const rows = await ctx.waitForDb(
      "SELECT word_count FROM node WHERE title = ?",
      [docTitle],
      (found) => found.length === 1 && found[0].word_count > 0,
    );
    if (!(rows[0].word_count > 0)) throw new Error("文档字数未更新");
    await ctx.expectText("已保存", { timeout: 15_000 });
    await ctx.screenshot("doc-edited");

    const blockCount = ctx.db("SELECT COUNT(*) AS count FROM doc_block_tree")[0].count;
    if (blockCount < 2) throw new Error(`文档块数量异常：${blockCount}`);

    await ctx.press("收藏 (⌘D)");
    await ctx.expectText("取消收藏 (⌘D)", { timeout: 5000 });
    if (ctx.db("SELECT starred FROM node WHERE title = ?", [docTitle])[0].starred !== 1) {
      throw new Error("收藏状态未写库");
    }
    await ctx.press("取消收藏 (⌘D)");
    await ctx.expectText("收藏 (⌘D)", { timeout: 5000 });

    await ctx.press("打开信息面板");
    await ctx.expectText("新建时间", { timeout: 5000 });
    await ctx.screenshot("doc-info-panel");
    await ctx.press("关闭信息面板");
    ctx.metrics.dialogs += 1;

    const exportDir = ctx.exportDir("doc");
    const formats = [
      { radio: "Markdown", extension: "md", signature: "text" },
      { radio: "HTML", extension: "html", signature: "text" },
      { radio: "Word", extension: "docx", signature: "zip" },
      { radio: "PDF", extension: "pdf", signature: "pdf" },
    ];
    for (const format of formats) {
      await ctx.press("导出文档");
      await ctx.expectText("导出格式", { timeout: 8000 });
      await ctx.press(format.radio, { role: "AXRadioButton", settle: 180 });
      await ctx.press("导出", { role: "AXButton" });
      await ctx.nativePath(exportDir, { button: "Save" });
      ctx.metrics.dialogs += 1;
      const filePath = path.join(exportDir, `${docTitle}.${format.extension}`);
      await ctx.waitForPath(filePath, { timeout: 20_000 });
      const bytes = fs.readFileSync(filePath);
      if (format.signature === "pdf" && bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
        throw new Error("PDF 文件头不正确");
      }
      if (format.signature === "zip" && bytes.subarray(0, 2).toString("latin1") !== "PK") {
        throw new Error("DOCX 文件头不正确");
      }
      if (format.signature === "text") {
        const text = bytes.toString("utf8");
        if (!text.includes("黑盒测试正文")) throw new Error(`${format.extension} 未包含正文`);
      }
      if (format.extension === "docx") ctx.shared.docxPath = filePath;
      ctx.log(`已导出 ${format.extension}：${filePath}`);
    }
    await ctx.screenshot("doc-exported");
  },
};
