import fs from "node:fs";
import path from "node:path";

/** 读取树主题的手动坐标；找不到或没有坐标返回 null。 */
function treeTopicPos(contentText, text) {
  try {
    const content = JSON.parse(contentText ?? "");
    const walk = (topic) => {
      if (!topic) return null;
      if (topic.text === text) return topic.pos ?? null;
      for (const child of topic.children ?? []) {
        const hit = walk(child);
        if (hit) return hit;
      }
      return null;
    };
    return walk(content.sheet?.root);
  } catch {
    return null;
  }
}

/** 思维导图：新建、编辑、自动保存、搜索索引与回收站。 */
export default {
  id: "26-mindmap",
  title: "思维导图 · 新建 · 编辑 · 保存 · 回收站",
  area: "文件树 / 思维导图",
  steps: [
    {
      action: "新建思维导图、添加子主题并验证手动定位",
      ui: "新建内容 → 思维导图 → 创建 → 中心主题 → Tab → 粘贴 → 拖动子主题 → 按结构重新排列",
      clicks: 6,
      dialogs: 1,
      note: "子主题提交后自动保存；拖到空白处写入 pos，重新排列后清除，均以 scene content_json 为准。",
    },
    {
      action: "删除后从回收站恢复",
      ui: "行内 ⋯ → 删除 → 确认 → 更多 → 回收站 → 恢复",
      clicks: 5,
      dialogs: 2,
      note: "场景随节点软删除保留，恢复后主题数不变。",
    },
  ],
  complexity: {
    clickTotal: 11,
    dialogs: 3,
    typingFields: 2,
    assessment:
      "思维导图复用文件树节点生命周期，新建入口与画板/文档一致；编辑只需两次键位即可扩展主题，拖拽手动定位与重新排列以数据库场景为判据，回收站与恢复沿用统一交互。",
  },
  async run(ctx) {
    const title = "E2E Mindmap";
    const child = "E2E 子主题";
    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.fill("名称", title);
    await ctx.press("思维导图");
    await ctx.press("创建");
    await ctx.expectText(title, { timeout: 10_000 });
    await ctx.expectText("中心主题", { timeout: 15_000 });
    ctx.metrics.dialogs += 1;

    await ctx.press("中心主题");
    await ctx.key("tab", "创建子主题");
    await ctx.paste(child, "输入子主题");
    await ctx.key("return", "提交子主题");
    await ctx.expectText(child, { timeout: 10_000 });
    await ctx.expectText("已保存", { timeout: 10_000 });

    // v2：结构切换与彩虹分支（页头菜单）
    const openStructureMenu = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await ctx.press("结构与主题");
        try {
          await ctx.expectText("思维导图（左右）", { timeout: 4000 });
          return;
        } catch {
          await ctx.key("escape");
        }
      }
      throw new Error("结构与主题菜单未打开");
    };
    await openStructureMenu();
    await ctx.press("时间轴");
    await ctx.expectText("中心主题", { timeout: 8000 });
    await openStructureMenu();
    await ctx.press("彩虹分支");
    await openStructureMenu();
    await ctx.press("思维导图（左右）");
    await ctx.expectText(child, { timeout: 8000 });

    // 手动定位：拖到空白处应写入 pos；按结构重新排列应清除
    const sceneSql =
      "SELECT content_json FROM mindmap_scene WHERE node_id = (SELECT id FROM node WHERE title = ?)";
    const target = (await ctx.find(child)).matches?.[0];
    if (!target) throw new Error("找不到子主题节点");
    const startX = target.point.x + target.size.width / 2;
    const startY = target.point.y + target.size.height / 2;
    await ctx.drag(startX, startY, startX + 160, startY + 260, "子主题拖到空白处");
    await ctx.waitForDb(
      sceneSql,
      [title],
      (rows) => rows.length === 1 && Boolean(treeTopicPos(rows[0].content_json, child)),
      { timeout: 10_000 },
    );
    await openStructureMenu();
    await ctx.press("按结构重新排列");
    await ctx.waitForDb(
      sceneSql,
      [title],
      (rows) => rows.length === 1 && !treeTopicPos(rows[0].content_json, child),
      { timeout: 10_000 },
    );

    // 图形导出走前端渲染器：真机确认 PNG/SVG 都能落盘且格式合法。
    const exportDir = ctx.exportDir("mindmap");
    for (const format of [
      { menu: "PNG 图片", extension: "png" },
      { menu: "SVG 矢量图", extension: "svg" },
    ]) {
      const filePath = path.join(exportDir, `${title}.${format.extension}`);
      let exported = false;
      for (let attempt = 0; attempt < 2 && !exported; attempt += 1) {
        if (attempt > 0) {
          // 原生保存面板可能卡在「前往文件夹」浮层（2026-10-29 现场截图）：先关干净再重来一次。
          await ctx.key("escape");
          await ctx.key("escape");
        }
        await ctx.menu("导出思维导图", format.menu);
        await ctx.nativePath(exportDir, { button: "Save" });
        ctx.metrics.dialogs += 1;
        try {
          await ctx.waitForPath(filePath, { timeout: 20_000 });
          exported = true;
        } catch (error) {
          if (attempt === 1) throw error;
        }
      }
      const bytes = fs.readFileSync(filePath);
      if (format.extension === "png") {
        if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
          throw new Error("导图 PNG 文件头不正确");
        }
        if (bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) {
          throw new Error("导图 PNG 尺寸无效");
        }
      } else if (!bytes.toString("utf8", 0, 200).includes("<svg")) {
        throw new Error("导图 SVG 文件头不正确");
      }
      ctx.log(`导图 ${format.extension}：${filePath}`);
    }

    // v3：大纲视图与自由主题
    await ctx.press("大纲视图");
    await ctx.expectText("大纲视图", { timeout: 8000 });
    await ctx.press("关闭大纲");
    await ctx.press("新建自由主题");
    await ctx.expectText("自由主题", { timeout: 8000 });
    await ctx.expectText("已保存", { timeout: 10_000 });

    const node = ctx.db("SELECT id FROM node WHERE title = ? AND type = 7", [title])[0];
    if (!node) throw new Error("思维导图节点未创建");
    await ctx.waitForDb(
      "SELECT topic_count FROM mindmap_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].topic_count >= 2,
      { timeout: 10_000 },
    );
    await ctx.waitForDb(
      "SELECT body FROM search_index WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].body.includes(child),
      { timeout: 10_000 },
    );
    await ctx.screenshot("mindmap-edit");

    await ctx.menu(`${title} 操作`, "删除");
    await ctx.expectText(`删除「${title}」？`);
    await ctx.press("删除");
    await ctx.expectGone(title, { timeout: 8_000 });
    await ctx.menu("更多 ⌘J", "回收站");
    await ctx.expectText(`恢复 ${title}`, { timeout: 8_000 });
    await ctx.press(`恢复 ${title}`);
    await ctx.expectText(title, { timeout: 8_000 });
    await ctx.key("escape");
    await ctx.waitForDb(
      "SELECT topic_count FROM mindmap_scene WHERE node_id = ?",
      [node.id],
      (rows) => rows.length === 1 && rows[0].topic_count >= 2,
      { timeout: 10_000 },
    );
    ctx.shared.mindmapNode = node.id;
    ctx.log(`思维导图 ${node.id} 完成编辑、自动保存与回收站恢复。`);
  },
};
