/**
 * 思维导图极限场景：深层大纲、高频输入与全部结构切换后，连接线与面板都必须完整可用。
 *
 * 关键设计：新增都在「大纲视图」里用行内「新建子主题」按钮完成。
 * 画布开 `onlyRenderVisibleElements` 后，跑出视口的节点不在 DOM 里，画布内联输入会消失，
 * Tab/粘贴从那时起全部落空；大纲行的按钮只在选中行可见，按下即进入行内编辑，不受视口影响。
 * 层级与数量都控制在面板一屏内（20 行），避免依赖滚动后的 AX 可见性。
 * 判据一律落库（场景 JSON），不靠屏幕文字。
 *
 * 1. 大纲里下钻 9 层：主题数 10、最大深度 9（第 9 层正好落在缩进封顶之外）；
 * 2. 最深层再高频新增 10 个主题：主题数 20；
 * 3. 点大纲行右侧「主题检查器」必须出现（2026-10-29 修复项）；
 * 4. 8 种结构逐个切换，每次在场景 JSON 里看到对应 structure。
 */
const STRUCTURES = [
  { label: "逻辑图（向右）", id: "logic-right" },
  { label: "逻辑图（向左）", id: "logic-left" },
  { label: "组织结构（向下）", id: "org-down" },
  { label: "组织结构（向上）", id: "org-up" },
  { label: "树状图", id: "tree" },
  { label: "时间轴", id: "timeline" },
  { label: "鱼骨图", id: "fishbone" },
  { label: "思维导图（左右）", id: "balanced" },
];

/** 场景 JSON 里的主题总数。 */
function countTopics(topic) {
  if (!topic) return 0;
  return 1 + (topic.children ?? []).reduce((total, child) => total + countTopics(child), 0);
}

/** 场景 JSON 里的最大深度（根为 0）。 */
function maxDepth(topic) {
  if (!topic) return 0;
  return Math.max(0, ...(topic.children ?? []).map((child) => 1 + maxDepth(child)));
}

/** 从查询结果取出场景 JSON；查询未命中返回 null。 */
function sceneOf(rows) {
  if (rows.length !== 1) return null;
  try {
    return JSON.parse(rows[0].content_json);
  } catch {
    return null;
  }
}

export default {
  id: "26c-mindmap-extreme",
  title: "思维导图 · 极限场景（深层大纲 / 高频输入 / 全结构）",
  area: "文件树 / 思维导图",
  steps: [
    {
      action: "大纲里下钻 9 层",
      ui: "新建思维导图 → 大纲视图 → 选中行「在该主题下新建子主题」→ 粘贴 → 回车 × 9",
      clicks: 10,
      dialogs: 1,
      note: "以场景 JSON 的主题数与最大深度为判据，不受画布虚拟化影响。",
    },
    {
      action: "最深层再连续下钻 10 层",
      ui: "「在该主题下新建子主题」→ 粘贴 → 回车 × 10",
      clicks: 10,
      dialogs: 0,
      note: "连续新增验证保存防抖不会退化成背靠背保存串；大纲该处只提供「新建子主题」，所以形状是更深一层的链。",
    },
    {
      action: "大纲里选中主题",
      ui: "点大纲行 → 右侧主题检查器",
      clicks: 1,
      dialogs: 0,
      note: "右侧主题检查器必须随选中出现（2026-10-29 修复项）。",
    },
    {
      action: "8 种结构逐个切换",
      ui: "结构与主题 → 逐个结构 → 每次校验场景结构",
      clicks: 16,
      dialogs: 0,
      note: "时间轴/鱼骨/向上组织过去会因 handle 不存在而丢线，现在由布局坐标自绘。",
    },
  ],
  complexity: {
    clickTotal: 37,
    dialogs: 1,
    typingFields: 20,
    assessment:
      "极限场景用例：在大纲里把层级推到 9 层、主题数推到 20，再逐个切换全部结构。判据落库不落屏，守住大纲缩进封顶、右侧检查器可达与结构切换三条回归。",
  },
  async run(ctx) {
    const title = "E2E 极限导图";
    const deepest = 9;
    const breadth = 10;
    const sceneSql =
      "SELECT content_json FROM mindmap_scene WHERE node_id = (SELECT id FROM node WHERE title = ?)";

    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.fill("名称", title);
    await ctx.press("思维导图");
    await ctx.press("创建");
    await ctx.expectText(title, { timeout: 10_000 });
    await ctx.expectText("中心主题", { timeout: 15_000 });
    ctx.metrics.dialogs += 1;

    await ctx.press("大纲视图");
    await ctx.expectText("大纲视图", { timeout: 8000 });
    await ctx.press("中心主题");

    for (let depth = 1; depth <= deepest; depth += 1) {
      await ctx.press("在该主题下新建子主题", { timeout: 8000 });
      await ctx.paste(`层${depth}`, `粘贴第 ${depth} 层主题`);
      await ctx.key("return", `提交第 ${depth} 层`);
    }
    await ctx.waitForDb(
      sceneSql,
      [title],
      (rows) => {
        const scene = sceneOf(rows);
        return (
          scene !== null &&
          countTopics(scene.sheet?.root) === deepest + 1 &&
          maxDepth(scene.sheet?.root) === deepest
        );
      },
      { timeout: 25_000 },
    );

    // 高频输入：在最深层再连续下钻 10 层（大纲只提供「新建子主题」）
    for (let index = 1; index <= breadth; index += 1) {
      await ctx.press("在该主题下新建子主题", { timeout: 8000 });
      await ctx.paste(`子${index}`, `粘贴第 ${index} 个子主题`);
      await ctx.key("return", `提交第 ${index} 个子主题`);
    }
    await ctx.waitForDb(
      sceneSql,
      [title],
      (rows) => {
        const scene = sceneOf(rows);
        return (
          scene !== null &&
          countTopics(scene.sheet?.root) === deepest + 1 + breadth &&
          maxDepth(scene.sheet?.root) === deepest + breadth
        );
      },
      { timeout: 25_000 },
    );

    // 大纲里点深层行 → 右侧主题检查器必须出现。
    // 用深层的「层9」：它的画布节点早已在视口外，AX 只会命中大纲里的这一行。
    await ctx.press("层9");
    await ctx.expectText("主题检查器", { timeout: 8000 });
    await ctx.press("关闭大纲");

    // 全部结构逐个切换：每次都要在场景里看到对应 structure
    for (const structure of STRUCTURES) {
      let opened = false;
      for (let attempt = 0; attempt < 2 && !opened; attempt += 1) {
        await ctx.press("结构与主题");
        try {
          await ctx.expectText("思维导图（左右）", { timeout: 4000 });
          opened = true;
        } catch {
          await ctx.key("escape");
        }
      }
      if (!opened) throw new Error("结构与主题菜单未打开");
      await ctx.press(structure.label);
      await ctx.waitForDb(
        sceneSql,
        [title],
        (rows) => sceneOf(rows)?.sheet?.structure === structure.id,
        { timeout: 10_000 },
      );
    }
    await ctx.expectText("已保存", { timeout: 20_000 });
  },
};
