import fs from "node:fs";
import path from "node:path";

/** 画板：插入预设组件、自动保存、PNG/SVG/Excalidraw 三格式导出。 */
export default {
  id: "40-board",
  title: "画板 · 插入预设组件 · 自动保存 · 三格式导出",
  area: "画板",
  steps: [
    {
      action: "打开 E2E Board",
      ui: "左侧文件树行",
      clicks: 1,
      dialogs: 0,
      note: "画板页头与 Excalidraw 工具条加载。",
    },
    {
      action: "页头「组件库」→ 插入「星屿便签」",
      ui: "画板页头右侧组件库按钮 → 选择器条目",
      clicks: 2,
      dialogs: 1,
      note: "组件库选择器只列启用库中的组件。",
    },
    {
      action: "等待自动保存",
      ui: "页头保存胶囊",
      clicks: 0,
      dialogs: 0,
      note: "检查 board_scene 元素数与版本。",
    },
    {
      action: "导出 PNG / SVG / Excalidraw",
      ui: "页头导出菜单 → 系统保存面板",
      clicks: 9,
      dialogs: 3,
      note: "每种格式独立保存；默认文件名为画板标题。",
    },
  ],
  complexity: {
    clickTotal: 12,
    dialogs: 4,
    typingFields: 0,
    assessment:
      "插入预设最省事的入口是页头「组件库」两次点击；Excalidraw 自带 Library 侧栏未作为预设入口，用户需要在两套“库”概念间切换。三格式导出藏在同一个页头菜单，入口清晰，但每次只导一种格式，连续导出需要重复打开菜单并确认系统保存，适合低频导出；若高频分享，建议记住上次格式。",
  },
  async run(ctx) {
    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) throw new Error("缺少前置用例创建的画板标题");

    await ctx.press(boardTitle);
    await ctx.expectText("导出画板", { timeout: 15_000 });
    await ctx.expectText("组件库", { timeout: 8000 });

    await ctx.press("组件库");
    await ctx.expectText("星屿便签", { timeout: 8000 });
    await ctx.press("星屿便签");
    ctx.metrics.dialogs += 1;

    const sceneRows = await ctx.waitForDb(
      `SELECT s.element_count, s.scene_version
       FROM board_scene s JOIN node n ON n.id = s.node_id
       WHERE n.title = ?`,
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].element_count >= 3,
    );
    await ctx.expectText("已保存", { timeout: 15_000 });
    await ctx.screenshot("board-inserted");

    const exportDir = ctx.exportDir("board");
    const formats = [
      { menu: "PNG 图片", extension: "png" },
      { menu: "SVG 矢量图", extension: "svg" },
      { menu: "Excalidraw 文件", extension: "excalidraw" },
    ];
    for (const format of formats) {
      await ctx.menu("导出画板", format.menu);
      await ctx.nativePath(exportDir, { button: "Save" });
      ctx.metrics.dialogs += 1;
      const filePath = path.join(exportDir, `${boardTitle}.${format.extension}`);
      await ctx.waitForPath(filePath, { timeout: 20_000 });
      const bytes = fs.readFileSync(filePath);
      if (format.extension === "png") {
        if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
          throw new Error("PNG 文件头不正确");
        }
        if (bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) {
          throw new Error("PNG 尺寸无效");
        }
      } else if (format.extension === "svg") {
        if (!bytes.toString("utf8", 0, 120).includes("<svg")) {
          throw new Error("SVG 文件头不正确");
        }
      } else {
        const scene = JSON.parse(bytes.toString("utf8"));
        if (scene.type !== "excalidraw" || !Array.isArray(scene.elements) || scene.elements.length < 1) {
          throw new Error("Excalidraw 文件结构不正确");
        }
      }
      ctx.log(`画板 ${format.extension}：${filePath}`);
    }

    const boardNode = ctx.db("SELECT id FROM node WHERE title = ?", [boardTitle])[0];
    ctx.shared.boardNodeId = boardNode.id;
    ctx.shared.boardElementCount = sceneRows[0].element_count;
    ctx.log(`board_scene 元素 ${sceneRows[0].element_count}，版本 ${sceneRows[0].scene_version}`);
    await ctx.screenshot("board-exported");
  },
};
