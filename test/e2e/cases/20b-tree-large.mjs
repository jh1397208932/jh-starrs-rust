/**
 * 文件树极限：300 个 Markdown 一次性导入后，树能完整展开到首尾子项。
 *
 * 判据落库 + 界面各一半：
 * 1. 导入文件夹下恰好 300 个文档节点；
 * 2. 展开文件夹后首条 `leaf-000` 与末条 `leaf-299` 都能在超时内出现（树构建/渲染没有被大数据量拖死或漏项）。
 */
import fs from "node:fs";
import path from "node:path";

const FILE_COUNT = 300;
const FOLDER_TITLE = "large-tree";

export default {
  id: "20b-tree-large",
  title: "文件树 · 极限场景（300 文件导入 / 展开首尾）",
  area: "文件树",
  steps: [
    {
      action: "生成 300 个 Markdown 并作为文件夹导入",
      ui: "左侧「更多 ⌘J」→ 导入… → 选择文件夹",
      clicks: 5,
      dialogs: 3,
      typing: 0,
      note: "大数据量导入：扫描 → 确认 → 批量建文档。",
    },
    {
      action: "展开导入的文件夹，检查首尾子项",
      ui: "左侧文件树行",
      clicks: 1,
      dialogs: 0,
      typing: 0,
      note: "验证树构建与渲染在 300 个同级节点下仍完整、可交互。",
    },
  ],
  complexity: {
    clickTotal: 6,
    dialogs: 3,
    typingFields: 0,
    assessment:
      "大树场景把「导入吞吐 + 树装配 + 行渲染」串在一条路径上：库里的子节点数给完整性判据，首尾子项可见给界面判据，能同时暴露漏项、重复挂载与渲染卡死。",
  },
  async run(ctx) {
    const root = ctx.exportDir(FOLDER_TITLE);
    for (let index = 0; index < FILE_COUNT; index += 1) {
      const name = `leaf-${String(index).padStart(3, "0")}.md`;
      fs.writeFileSync(path.join(root, name), `# leaf ${index}\n\n正文 ${index}\n`);
    }

    await ctx.menu("更多 ⌘J", "导入…");
    await ctx.expectText("导入到", { timeout: 8000 });
    await ctx.press("选择文件夹");
    await ctx.nativePath(root, { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.expectText(`将导入 ${FILE_COUNT} 个`, { timeout: 30_000 });
    await ctx.press("导入", { role: "AXButton" });
    await ctx.expectText("已导入", { timeout: 120_000 });
    await ctx.press("完成");
    ctx.metrics.dialogs += 1;

    const folder = ctx.db("SELECT id FROM node WHERE type = 1 AND title = ?", [FOLDER_TITLE])[0];
    if (!folder) throw new Error("文件夹导入未创建目录节点");
    const children = ctx.db(
      "SELECT COUNT(*) AS count FROM node WHERE parent_id = ? AND type = 2 AND deleted_at IS NULL",
      [folder.id],
    )[0].count;
    if (children !== FILE_COUNT) {
      throw new Error(`导入子节点数不符：${children} != ${FILE_COUNT}`);
    }
    const duplicate = ctx.db(
      "SELECT COUNT(*) AS count FROM (SELECT title FROM node WHERE parent_id = ? GROUP BY title HAVING COUNT(*) > 1)",
      [folder.id],
    )[0].count;
    if (duplicate !== 0) throw new Error(`树中出现重复标题：${duplicate} 组`);

    // 新建文件夹默认展开；不同会话也可能记住折叠状态。这里按"看不见就点一次"收敛，避免把展开/折叠方向写死。
    const hasLeaf = async (text) => {
      try {
        await ctx.expectText(text, { timeout: 2000 });
        return true;
      } catch {
        return false;
      }
    };
    let expanded = false;
    for (let attempt = 0; attempt < 3 && !expanded; attempt += 1) {
      expanded = await hasLeaf("leaf-000");
      if (!expanded) await ctx.press(FOLDER_TITLE);
    }
    if (!expanded) throw new Error("无法展开导入的文件夹");
    await ctx.expectText("leaf-299", { timeout: 20_000 });
    await ctx.screenshot("tree-large-expanded");
    ctx.log(`大树导入：${children} 个文档，首尾子项均可见`);
  },
};
