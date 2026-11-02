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
      action: "画布右缘「组件」→ 切换分类 → 插入「星屿便签」→ 拖动「矩形」→ 收起面板",
      ui: "画布右缘把手 → 分类标签与缩略图网格 → 画布落点",
      clicks: 9,
      dialogs: 0,
      note: "内置组件按基础/架构/流程建模/产品原型/数据图表分类；带标签组件与普通形状均可点击插入，拖拽按落点插入。",
    },
    {
      action: "页头「⋯」→ 帮助与快捷键",
      ui: "画板页头最后一个按钮 → 自家帮助弹窗",
      clicks: 2,
      dialogs: 1,
      note: "快捷键读当前配置；无 Excalidraw 外链；有关闭按钮。",
    },
    {
      action: "页头「⋯」→ 画布背景",
      ui: "画板页头最后一个按钮 → 背景色块",
      clicks: 2,
      dialogs: 0,
      note: "背景修改立即生效并进入自动保存。",
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
    clickTotal: 24,
    dialogs: 4,
    typingFields: 0,
    assessment:
      "组件库是画布右侧的停靠面板：分类标签配合缩略图网格，点击插入画布中央，拖拽按落点插入，面板保持打开便于连续取用；页面头不再重复放组件库按钮。帮助、重置与画布背景收进页头最后一个「⋯」，画布左上不再有原生汉堡菜单；快捷键说明直接读设置里的绑定。三格式导出仍在同一页头菜单，适合低频分享。",
  },
  async run(ctx) {
    const boardTitle = ctx.shared.boardTitle;
    if (!boardTitle) throw new Error("缺少前置用例创建的画板标题");

    await ctx.press(boardTitle);
    await ctx.expectText("导出画板", { timeout: 15_000 });
    await ctx.expectText("画板更多操作", { timeout: 8000 });
    // 页头不再有「组件库」按钮；面板收起时只有右缘把手（标题含「展开组件库」）。
    const componentMatches = await ctx.find("组件库");
    if (componentMatches.matches.some((match) => match.title === "组件库")) {
      throw new Error("画板页头仍存在「组件库」按钮");
    }

    await ctx.press("展开组件库");
    await ctx.expectText("星屿便签", { timeout: 8000 });
    await ctx.expectText("流程建模", { timeout: 5000 });
    await ctx.press("架构");
    await ctx.expectText("服务", { timeout: 5000 });
    await ctx.screenshot("board-library-architecture");
    // 带标签的组件：转换后应包含容器与绑定文字，插入后元素数增加。
    await ctx.press("插入组件 服务");
    await ctx.waitForDb(
      "SELECT element_count FROM board_scene s JOIN node n ON n.id = s.node_id WHERE n.title = ?",
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].element_count >= 2,
      { timeout: 15_000 },
    );
    await ctx.press("流程建模");
    await ctx.expectText("判断", { timeout: 5000 });
    await ctx.press("数据图表");
    await ctx.expectText("柱状图", { timeout: 5000 });
    await ctx.screenshot("board-library-chart");

    // 缩略图管线回归门：pump 完成后会写一条 perf.library 汇总。
    // 旧实现每张固定让出 16ms（200+ 张≈3.3s），这里要求平均单张 < 8ms。
    const libraryLine = await ctx.waitForLog(/perf\.library\] previews=(\d+) total=(\d+)ms/, {
      timeout: 20_000,
    });
    const libraryMatch = libraryLine.match(/previews=(\d+) total=(\d+)ms/);
    const previewCount = Number(libraryMatch?.[1] ?? 0);
    const previewTotal = Number(libraryMatch?.[2] ?? 0);
    const previewAverage = previewTotal / Math.max(previewCount, 1);
    ctx.log(`组件库缩略图：${previewCount} 张 / ${previewTotal}ms，平均 ${previewAverage.toFixed(1)}ms`);
    if (previewCount < 20) throw new Error(`组件库预览条数异常：${previewCount}`);
    if (!(previewAverage < 8)) {
      throw new Error(`缩略图平均 ${previewAverage.toFixed(1)}ms ≥ 8ms（疑似退回逐张让出）`);
    }
    await ctx.press("基础");
    await ctx.expectText("星屿便签", { timeout: 5000 });
    await ctx.press("插入组件 星屿便签");
    await ctx.screenshot("board-library-panel");

    // 拖拽：从卡片按下拖到画布落点，矩形为单个图元，元素数应 +1。
    const cardMatches = await ctx.find("插入组件 矩形");
    const card =
      cardMatches.matches.find((match) => match.role === "AXButton") ?? cardMatches.matches[0];
    if (!card) throw new Error("找不到矩形组件卡片");
    const bounds = ctx.ax.window().bounds;
    // 先等点击插入落库，拖拽的基线才是确定值。
    const insertedRows = await ctx.waitForDb(
      "SELECT element_count FROM board_scene s JOIN node n ON n.id = s.node_id WHERE n.title = ?",
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].element_count >= 3,
      { timeout: 15_000 },
    );
    const beforeDrag = insertedRows[0].element_count;
    ctx.log(`拖拽前元素：${beforeDrag}`);
    await ctx.drag(
      card.point.x + card.size.width / 2,
      card.point.y + card.size.height / 2,
      bounds.X + 360,
      bounds.Y + 430,
      "拖动矩形到画布",
    );
    const draggedRows = await ctx.waitForDb(
      "SELECT element_count FROM board_scene s JOIN node n ON n.id = s.node_id WHERE n.title = ?",
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].element_count > beforeDrag,
      { timeout: 15_000 },
    );
    ctx.log(`拖拽插入：画板元素 ${beforeDrag} → ${draggedRows[0].element_count}`);
    await ctx.screenshot("board-library-dragged");
    await ctx.press("收起组件库");

    // 帮助：只含本应用内容，键位来自设置，有明确关闭按钮。
    await ctx.press("画板更多操作");
    await ctx.press("帮助与快捷键");
    await ctx.expectText("画布内置", { timeout: 5000 });
    await ctx.expectText("固定键位，不可修改", { timeout: 5000 });
    await ctx.expectGone("Excalidraw links", { timeout: 1000 });
    await ctx.screenshot("board-help");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    // 画布背景：改完立即生效并进入自动保存。
    await ctx.press("画板更多操作");
    await ctx.press("画布背景 2");
    await ctx.key("escape");
    await ctx.waitForDb(
      `SELECT s.app_state_json FROM board_scene s JOIN node n ON n.id = s.node_id WHERE n.title = ?`,
      [boardTitle],
      (rows) => rows.length === 1 && rows[0].app_state_json.includes("#f8f9fa"),
      { timeout: 15_000 },
    );

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
      // 等原生保存面板完全关闭，避免下一次菜单点击被残留 sheet 吞掉。
      if (!(await ctx.waitForNoSheet({ timeout: 3000 }))) {
        await ctx.key("escape");
        await ctx.waitForNoSheet({ timeout: 1500 });
      }
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
