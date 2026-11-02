import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 新建入口收敛、附件树内上传（含选文件夹批量上传）、常用格式预览、
 * 存储保留时间即时生效与清理文案、知识库管理列。
 */
export default {
  id: "96-misc",
  title: "新建入口 · 文件夹上传 · 附件预览 · 存储即时生效 · 知识库管理",
  area: "入口诚实化 / 附件 / 存储",
  steps: [
    {
      action: "打开新建弹窗检查类型与上传附件入口",
      ui: "文件树标题 +",
      clicks: 1,
      dialogs: 1,
      note: "文件夹/文档/画板/思维导图四类 + 页脚「上传附件」。",
    },
    {
      action: "打开并关闭全局搜索",
      ui: "顶栏搜索胶囊",
      clicks: 1,
      dialogs: 1,
      note: "搜索面板可用，Esc 关闭。",
    },
    {
      action: "上传附件里选中一个含子目录的文件夹",
      ui: "新建内容 → 上传附件 → 系统双选面板",
      clicks: 2,
      dialogs: 1,
      note: "按钮不变，但面板可同时选文件与文件夹；文件夹按层级建节点并递归上传。",
    },
    {
      action: "逐个打开 txt / Markdown / Word / 图片附件查看预览",
      ui: "附件标签页预览区",
      clicks: 4,
      dialogs: 0,
      note: "不再有「校验完整性」；信息表也没有「创建时间」；不支持的格式仍是下载兜底。",
    },
    {
      action: "设置 → 存储：改保留时间不点保存，并执行一次清理",
      ui: "设置存储页「保留时间」「开始清理」",
      clicks: 3,
      dialogs: 0,
      typing: 1,
      note: "改完即生效（无保存按钮）；清理说明只有用户能读懂的临时/过期数据表述。",
    },
    {
      action: "知识库管理检查列",
      ui: "更多 → 管理知识库",
      clicks: 2,
      dialogs: 1,
      note: "列表不再显示「条目数」。",
    },
    {
      action: "删除附件节点并在回收站永久删除",
      ui: "行内 ⋯ → 删除 → 回收站 → 永久删除",
      clicks: 4,
      dialogs: 3,
      note: "移入回收站仍保留引用，永久删除后才标记失去引用（等保留期真正清除）。",
    },
  ],
  complexity: {
    clickTotal: 17,
    dialogs: 7,
    typingFields: 1,
    assessment:
      "创建入口收敛为文件夹/文档/画板/思维导图四类；上传附件按钮不变，但系统面板可以一次选中整个文件夹并按目录层级建树，等价于批量上传。附件页只留下载与预览，不再暴露完整性校验这类程序内部概念；存储页的保留时间改完即生效。",
  },
  async run(ctx) {
    // ---- 新建弹窗：四类 + 上传附件 ----
    await ctx.press("新建内容");
    await ctx.expectText("创建", { timeout: 5000 });
    for (const kind of ["文件夹", "文档", "画板", "思维导图"]) {
      const found = await ctx.find(kind);
      if (found.count === 0) throw new Error(`新建弹窗缺少${kind}类型`);
    }
    await ctx.screenshot("create-kinds-with-upload");
    await ctx.press("取消");
    ctx.metrics.dialogs += 1;

    // ---- 全局搜索 ----
    if ((await ctx.find("全局搜索")).matches.length === 0) {
      throw new Error("顶栏搜索入口不存在");
    }
    await ctx.press("全局搜索");
    await ctx.expectText("搜索标题与正文…", { timeout: 5000 });
    await ctx.key("escape");
    ctx.metrics.dialogs += 1;

    // ---- 造一个含子目录的文件夹，用「上传附件」面板整选 ----
    const sourceRoot = ctx.exportDir("upload-src");
    const folderName = path.basename(sourceRoot);
    fs.mkdirSync(path.join(sourceRoot, "子目录"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "说明.txt"), "纯文本预览内容");
    fs.copyFileSync(ctx.fixture("sample.md"), path.join(sourceRoot, "笔记.md"));
    fs.copyFileSync(ctx.fixture("sample.docx"), path.join(sourceRoot, "文档.docx"));
    fs.copyFileSync(ctx.fixture("swatch.png"), path.join(sourceRoot, "色块.png"));
    fs.writeFileSync(path.join(sourceRoot, "子目录", "深层.txt"), "深层文件");

    // 上传入口在文件树工具栏：点开先选「附件 / 文件夹」。
    await ctx.menu("上传附件", "选择文件夹");
    // 系统目录面板：前往目标目录后回车确认（目录面板里第二次回车即选中当前目录）。
    await ctx.nativePath(sourceRoot, { button: "打开" });
    ctx.metrics.dialogs += 1;

    await ctx.waitForDb(
      "SELECT COUNT(*) AS c FROM node WHERE title = ? AND type = 6",
      ["说明.txt"],
      (rows) => rows[0].c === 1,
      { timeout: 30_000 },
    );
    const layered = ctx.db(
      "SELECT n.title, p.title AS parent FROM node n LEFT JOIN node p ON p.id = n.parent_id WHERE n.title IN ('子目录','深层.txt') ORDER BY n.title",
    );
    const subfolder = layered.find((row) => row.title === "子目录");
    const deepFile = layered.find((row) => row.title === "深层.txt");
    assert.equal(subfolder?.parent, folderName, "子目录应挂在所选文件夹节点下");
    assert.equal(deepFile?.parent, "子目录", "深层文件应挂在子目录下");

    // ---- 预览：txt / Markdown / Word / 图片 ----
    await ctx.press("说明.txt");
    await ctx.expectText("纯文本预览内容", { timeout: 10_000 });
    await ctx.expectNoText("校验完整性");
    await ctx.expectNoText("校验通过");
    await ctx.expectText("更新时间", { timeout: 5000 });
    await ctx.expectNoText("创建时间");
    await ctx.screenshot("attachment-preview-text");

    await ctx.press("笔记.md");
    await ctx.expectText("黑盒导入测试", { timeout: 12_000 });
    await ctx.screenshot("attachment-preview-markdown");

    await ctx.press("文档.docx");
    await ctx.expectText("Word 预览标题", { timeout: 20_000 });
    await ctx.screenshot("attachment-preview-word");

    await ctx.press("色块.png");
    await ctx.expectNoText("该类型暂不支持预览，可下载后查看。");
    // 图片真的解码成功才会出现自然尺寸标注（32 × 32 的实心色块）。
    await ctx.expectText("32 × 32", { timeout: 12_000 });
    await ctx.screenshot("attachment-preview-image");

    // ---- 下载仍可用 ----
    const exportDir = ctx.exportDir("attachment");
    await ctx.press("说明.txt");
    await ctx.press("下载");
    await ctx.nativePath(exportDir, { button: "Save" });
    ctx.metrics.dialogs += 1;
    const exported = path.join(exportDir, "说明.txt");
    await ctx.waitForPath(exported, { timeout: 15_000 });
    if (fs.readFileSync(exported, "utf8") !== "纯文本预览内容") {
      throw new Error("下载的 说明.txt 内容异常");
    }

    // ---- 存储：保留时间改完即生效（没有保存按钮）----
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("存储", { role: "AXRadioButton" });
    await ctx.expectText("保留时间", { timeout: 8000 });
    await ctx.expectText("修改后自动生效", { timeout: 5000 });
    await ctx.expectNoText("保存");
    // 清理说明只讲用户能懂的那一层，不出现技术原理名词。
    await ctx.expectText("只清理临时数据和过期数据", { timeout: 5000 });
    await ctx.expectNoText("哈希");
    await ctx.expectNoText("索引");
    await ctx.screenshot("settings-retention-instant");

    await ctx.fill("回收站保留天数", "14");
    await ctx.waitForDb(
      "SELECT value FROM workspace_meta WHERE key = 'attachment.trash_retention_days'",
      [],
      (rows) => rows.length === 1 && rows[0].value === "14",
      { timeout: 10_000 },
    );
    await ctx.expectText("已保存", { timeout: 5000 });

    await ctx.press("开始清理");
    await ctx.expectText("确认清理？", { timeout: 5000 });
    await ctx.press("确认清理？");
    const notice = await ctx.waitForAnyText(["已清理", "没有需要清理的数据"], {
      timeout: 20_000,
    });
    ctx.log(`清理结果提示命中：${notice}`);
    await ctx.screenshot("storage-cleaned");
    await ctx.press("完成");
    ctx.metrics.dialogs += 1;
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });

    // ---- 知识库管理：没有「条目数」列 ----
    // 知识库管理入口在工作区切换浮层里，不在「更多」菜单。
    await ctx.press("切换工作区");
    await ctx.press("管理知识库", { timeout: 8000 });
    await ctx.expectText("知识库管理", { timeout: 8000 });
    await ctx.expectNoText("条目数");
    await ctx.screenshot("kb-manager-no-count");
    await ctx.press("取消", { timeout: 6000 }).catch(async () => {
      await ctx.key("escape");
    });
    ctx.metrics.dialogs += 1;
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });

    // ---- 删除 → 永久删除 → 附件失去引用 ----
    await ctx.menu("说明.txt 操作", "删除");
    await ctx.expectText("删除「说明.txt」？", { timeout: 5000 });
    await ctx.press("删除");
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT deleted_at FROM node WHERE title = '说明.txt'",
      [],
      (rows) => rows.length === 1 && rows[0].deleted_at !== null,
      { timeout: 10_000 },
    );
    // 移入回收站 ≠ 失去引用：引用行必须留着，否则「恢复」回来就是一个空附件节点。
    const trashed = ctx.db(
      "SELECT orphaned_at FROM attachment WHERE name = '说明.txt' ORDER BY created_at DESC LIMIT 1",
    );
    assert.equal(
      trashed[0]?.orphaned_at ?? null,
      null,
      "节点只是移入回收站时，附件不应被标记失去引用",
    );

    await ctx.menu("更多 ⌘J", "回收站");
    await ctx.expectText("永久删除 说明.txt", { timeout: 8000 });
    await ctx.press("永久删除 说明.txt");
    // 行内按钮带 aria-label，WebKit 不再单独暴露按钮内部的可见文字，
    // 「确认删除？」在 AX 树里读不到（截图 node-trash-purge-armed 作证），
    // 因此第二次点击按可访问名来打。
    await ctx.expectText("确认永久删除 说明.txt", { timeout: 5000 });
    await ctx.screenshot("node-trash-purge-armed");
    await ctx.press("确认永久删除 说明.txt");
    await ctx.expectGone("永久删除 说明.txt", { timeout: 10_000 });
    await ctx.key("escape");
    ctx.metrics.dialogs += 1;
    await ctx.waitForDb(
      "SELECT orphaned_at FROM attachment WHERE name = '说明.txt' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].orphaned_at !== null,
      { timeout: 10_000 },
    );
    ctx.log(
      "文件夹按层级导入、四类预览可用、保留时间自动生效、清理文案无技术名词；移入回收站仍保留引用，永久删除才标记失去引用。",
    );
  },
};
