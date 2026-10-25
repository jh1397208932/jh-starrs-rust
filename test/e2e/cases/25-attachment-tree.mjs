import fs from "node:fs";
import path from "node:path";

/** 附件树：上传、预览页、下载、重命名与引用关系。 */
export default {
  id: "25-attachment-tree",
  title: "附件树 · 上传 · 预览 · 下载 · 重命名",
  area: "文件树 / 附件",
  steps: [
    {
      action: "文件树顶部「上传附件」选择 pixel.png",
      ui: "文件树标题右侧上传图标 → 系统文件面板",
      clicks: 2,
      dialogs: 1,
      note: "上传后自动打开附件标签页，并创建 type=6 节点与关联。",
    },
    {
      action: "预览页下载附件",
      ui: "附件页右上「下载」→ 系统保存面板",
      clicks: 2,
      dialogs: 1,
      note: "下载内容必须与 fixture 字节一致。",
    },
    {
      action: "文件树行 ⋯ → 重命名",
      ui: "附件行菜单 → 重命名弹窗",
      clicks: 3,
      dialogs: 1,
      note: "节点标题与 attachment.name 同步。",
    },
  ],
  complexity: {
    clickTotal: 7,
    dialogs: 3,
    typingFields: 1,
    assessment:
      "附件上传入口在文件树顶部与文件夹菜单，和新建/导入并列，路径清晰。附件页把预览、元数据与下载集中在一处；重命名同时影响下载文件名，符合用户预期。",
  },
  async run(ctx) {
    const uploadDir = ctx.exportDir("attachment-tree");
    await ctx.press("上传附件");
    await ctx.nativePath(ctx.fixture("pixel.png"), { button: "Open" });
    ctx.metrics.dialogs += 1;

    await ctx.expectText("下载", { timeout: 20_000 });
    await ctx.expectText("pixel.png", { timeout: 10_000 });

    const node = ctx.db(
      "SELECT id, title, type FROM node WHERE type = 6 ORDER BY create_time DESC LIMIT 1",
    )[0];
    if (!node) throw new Error("附件上传未创建 type=6 节点");
    const refs = ctx.db("SELECT object_id FROM node_attachment WHERE node_id = ?", [node.id]);
    if (refs.length !== 1) throw new Error("附件节点引用未建立");

    await ctx.press("下载");
    await ctx.nativePath(path.join(uploadDir, "pixel-download.png"), { button: "Save" });
    ctx.metrics.dialogs += 1;
    const downloaded = path.join(uploadDir, "pixel-download.png");
    await ctx.waitForPath(downloaded, { timeout: 15_000 });
    if (fs.statSync(downloaded).size !== 68) throw new Error("附件下载大小异常");

    await ctx.menu("pixel.png 操作", "重命名");
    await ctx.expectText("重命名", { timeout: 5000 });
    const renamed = "附件改名.png";
    await ctx.fill("名称", renamed);
    await ctx.press("保存");
    await ctx.waitForDb(
      "SELECT title FROM node WHERE id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].title === renamed,
      { timeout: 10_000 },
    );
    await ctx.waitForDb(
      "SELECT name FROM attachment WHERE id = ?",
      [refs[0].object_id],
      (rows) => rows.length === 1 && rows[0].name === renamed,
      { timeout: 10_000 },
    );
    await ctx.expectText(renamed, { timeout: 5000 });
    await ctx.expectText(`附件详情 ${renamed}`, { timeout: 8000 });
    ctx.shared.attachmentTreeTitle = renamed;
    await ctx.screenshot("attachment-tree");
    ctx.log(`附件节点 ${node.id} 重命名为 ${renamed}`);
  },
};
