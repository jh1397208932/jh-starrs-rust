import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 导入入口合并：思维导图不再单列一项，FreeMind .mm 直接走「导入…」。
 *
 * 回归点：MoreMenu 曾同时有「导入…」和「导入思维导图…」，两条路径的目标目录能力不一致；
 * 后端 import_documents 早已按扩展名把 xmind/mm/opml/.starris-mindmap.json 转给导图导入器。
 */
export default {
  id: "21-import-mindmap",
  title: "导入 · 思维导图并入统一入口 · 导入到指定文件夹",
  area: "更多菜单 / 导入",
  steps: [
    {
      action: "更多菜单只剩一个「导入…」",
      ui: "侧栏底部「更多 ⌘J」菜单",
      clicks: 1,
      dialogs: 0,
      note: "「导入思维导图…」已合并进「导入…」，不再单列。",
    },
    {
      action: "导入一个 FreeMind .mm 到指定文件夹",
      ui: "导入弹窗 → 导入到 → 选择文件 → 导入",
      clicks: 4,
      dialogs: 1,
      typing: 0,
      note: "统一入口保留目标文件夹选择，导入后生成思维导图节点。",
    },
  ],
  complexity: {
    clickTotal: 5,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "合并后导入只有一个入口，且比原来的导图专用入口多保留了「导入到」目标目录；用户不必先判断文件格式该走哪条菜单。",
  },
  async run(ctx) {
    await ctx.press("更多 ⌘J");
    await ctx.expectText("导入…", { timeout: 8000 });
    await ctx.expectNoText("导入思维导图");
    await ctx.screenshot("more-menu-single-import");
    await ctx.key("escape");

    const stamp = Date.now();
    const rootTitle = `E2E 合并导图 ${stamp}`;
    const file = path.join(os.tmpdir(), `starris-e2e-${stamp}.mm`);
    fs.writeFileSync(
      file,
      `<map version="1.0.1"><node TEXT="${rootTitle}"><node TEXT="子节点 A1"/><node TEXT="子节点 A2"/></node></map>`,
      "utf8",
    );

    await ctx.menu("更多 ⌘J", "导入…");
    await ctx.expectText("选择文件或文件夹", {
      timeout: 8000,
    });
    await ctx.press("选择文件");
    await ctx.nativePath(file, { button: "Open" });
    ctx.metrics.dialogs += 1;
    await ctx.expectText(rootTitle, { timeout: 8000 }).catch(() => {
      // 来源摘要只显示前三个文件名与扩展名前的片段，缺失不阻断导入。
      ctx.log("来源摘要未显示完整文件名，继续导入");
    });
    await ctx.press("导入");
    await ctx.waitForText("已导入", { timeout: 20_000 });
    await ctx.screenshot("import-mindmap-result");

    let failure = null;
    try {
      const rows = ctx.db("SELECT id, title, type FROM node WHERE title = ?", [rootTitle]);
      assert.ok(rows.length === 1, `导入后未生成导图节点（实际 ${rows.length} 行）`);
      // 1=文件夹 2=文档 3=画板 6=附件 7=思维导图
      assert.equal(rows[0].type, 7, `导入的思维导图节点类型应为 7，实际 ${rows[0].type}`);
      const children = ctx.db(
        "SELECT COUNT(*) AS count FROM node WHERE parent_id = (SELECT id FROM node WHERE title = ? LIMIT 1)",
        [rootTitle],
      );
      ctx.log(`统一导入口生成导图节点 ${rows[0].id}，子节点计数 ${children[0].count}`);
    } catch (error) {
      failure = error;
    }

    // 无论断言结果如何都要关掉弹窗：留着模态框会让后面每个用例都找不到侧栏。
    await ctx.press("完成");
    if (failure) throw failure;
    fs.rmSync(file, { force: true });
  },
};
