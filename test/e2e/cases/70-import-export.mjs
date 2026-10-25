import fs from "node:fs";
import path from "node:path";

/** 导入与整库导出：Markdown / Excalidraw / Word / 文件夹导入，全部导出含画板与附件。 */
export default {
  id: "70-import-export",
  title: "导入 · Markdown/Excalidraw/Word/文件夹 · 全部导出",
  area: "导入导出",
  steps: [
    {
      action: "导入 Markdown（单文件）",
      ui: "更多 → 导入… → 选择文件 → 导入",
      clicks: 5,
      dialogs: 2,
      note: "系统面板选择 test/fixtures/files/sample.md。",
    },
    {
      action: "导入 Excalidraw（单文件）",
      ui: "同上，选择 sample.excalidraw",
      clicks: 5,
      dialogs: 2,
      note: "应创建可编辑画板节点。",
    },
    {
      action: "导入 Word（复用导出的 E2E Doc.docx）",
      ui: "同上，选择导出的 docx",
      clicks: 5,
      dialogs: 2,
      note: "验证导出→再导入闭环。",
    },
    {
      action: "文件夹导入（保留层级）",
      ui: "导入弹窗「选择文件夹」→ 导入",
      clicks: 4,
      dialogs: 2,
      note: "测试目录内 Markdown 与子目录节点。",
    },
    {
      action: "全部导出（Markdown）",
      ui: "更多 → 全部导出 → 导出",
      clicks: 4,
      dialogs: 2,
      note: "验证画板三格式、attach/pixel.png、attachments.json、manifest。",
    },
  ],
  complexity: {
    clickTotal: 23,
    dialogs: 10,
    typingFields: 0,
    assessment:
      "导入统一收在更多菜单，来源选择与目标文件夹清晰；每次导入都要经过“选择来源 → 确认导入”，单文件批量导入路径较长。全部导出只需选目录，但画板三格式和附件由后端/桌面端自动补齐，用户无需逐项选择，符合预期。导入导出都依赖系统面板；路径较深时操作成本主要落在文件导航。",
  },
  async run(ctx) {
    const importFile = async (filePath) => {
      await ctx.menu("更多 ⌘J", "导入…");
      await ctx.expectText("导入到", { timeout: 8000 });
      await ctx.press("选择文件");
      await ctx.nativePath(filePath, { button: "Open" });
      ctx.metrics.dialogs += 1;
      await ctx.press("导入", { role: "AXButton" });
      await ctx.expectText("已导入", { timeout: 20_000 });
      await ctx.press("完成");
      ctx.metrics.dialogs += 1;
    };

    await importFile(ctx.fixture("sample.md"));
    const sampleDoc = ctx.db(
      "SELECT id, type, title FROM node WHERE title = 'sample' AND type = 2",
    )[0];
    if (!sampleDoc) throw new Error("Markdown 导入未创建 sample 文档");
    await ctx.press("sample");
    await ctx.expectText("黑盒导入测试", { timeout: 10_000 });
    await ctx.screenshot("import-markdown");

    await importFile(ctx.fixture("sample.excalidraw"));
    const importedBoards = ctx.db(
      "SELECT n.id, n.title FROM node n WHERE n.type = 3 AND n.title LIKE 'sample%' ORDER BY n.create_time DESC LIMIT 1",
    );
    if (importedBoards.length === 0) throw new Error("Excalidraw 导入未创建画板");
    const importedBoard = importedBoards[0];
    const importedScene = ctx.db("SELECT element_count FROM board_scene WHERE node_id = ?", [
      importedBoard.id,
    ]);
    if (importedScene.length === 0 || importedScene[0].element_count < 1) {
      throw new Error("Excalidraw 导入未写入场景");
    }
    ctx.shared.importedBoard = importedBoard.title;

    if (!ctx.shared.docxPath) throw new Error("缺少前置 Word 导出文件");
    await importFile(ctx.shared.docxPath);
    const wordDocs = ctx.db(
      "SELECT COUNT(*) AS count FROM node WHERE type = 2 AND title LIKE 'E2E Doc%'",
    )[0].count;
    if (wordDocs < 2) throw new Error("Word 导入未创建新文档");

    // 文件夹导入：目录下放一份 Markdown 和一个子目录。
    const batchRoot = ctx.exportDir("import-batch");
    const nested = path.join(batchRoot, "nested");
    fs.mkdirSync(nested, { recursive: true });
    fs.copyFileSync(ctx.fixture("sample.md"), path.join(batchRoot, "batch.md"));
    fs.copyFileSync(ctx.fixture("sample.md"), path.join(nested, "deep.md"));

    await ctx.menu("更多 ⌘J", "导入…");
    await ctx.expectText("导入到", { timeout: 8000 });
    await ctx.press("选择文件夹");
    await ctx.nativePath(batchRoot, { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.press("导入", { role: "AXButton" });
    await ctx.expectText("已导入", { timeout: 20_000 });
    await ctx.press("完成");
    ctx.metrics.dialogs += 1;
    const folderCount = ctx.db(
      "SELECT COUNT(*) AS count FROM node WHERE type = 1 AND title = 'import-batch'",
    )[0].count;
    if (folderCount < 1) throw new Error("文件夹导入未创建目录节点");

    // 全部导出
    const allDir = ctx.exportDir("all");
    await ctx.menu("更多 ⌘J", "全部导出");
    await ctx.expectText("全部导出", { timeout: 8000 });
    await ctx.press("导出", { role: "AXButton" });
    await ctx.nativePath(allDir, { button: "Open" });
    ctx.metrics.dialogs += 1;

    const kbRoot = path.join(allDir, "默认知识库");
    const manifestPath = path.join(kbRoot, "manifest.json");
    await ctx.waitForPath(manifestPath, { timeout: 30_000 });
    const boardRoot = path.join(kbRoot, "E2E Board");
    const required = [
      path.join(boardRoot, "E2E Board.excalidraw"),
      path.join(boardRoot, "E2E Board.png"),
      path.join(boardRoot, "E2E Board.svg"),
      path.join(boardRoot, "attachments.json"),
      path.join(boardRoot, "attach", "pixel.png"),
      path.join(kbRoot, "E2E Doc.md"),
    ];
    if (ctx.shared.attachmentTreeTitle) {
      required.push(path.join(kbRoot, ctx.shared.attachmentTreeTitle));
    }
    for (const file of required) {
      if (!fs.existsSync(file)) throw new Error(`全部导出缺少：${file}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(manifest.boards) || manifest.boards.length < 1) {
      throw new Error("manifest 未列出画板");
    }
    if (
      ctx.shared.attachmentTreeTitle &&
      (!Array.isArray(manifest.attachmentNodes) || manifest.attachmentNodes.length < 1)
    ) {
      throw new Error("manifest 未列出附件节点");
    }
    await ctx.screenshot("all-export");
    ctx.shared.allExportRoot = kbRoot;
    ctx.log(`全部导出根：${kbRoot}`);
  },
};
