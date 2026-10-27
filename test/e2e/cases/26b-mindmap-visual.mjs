/**
 * 思维导图视觉系统：浮动详情/大纲、节点元信息、下划线、长文本自适应与悬停卡。
 *
 * 这些是 2026-10-27 体验修复的验收点：用真机截屏与几何读数固化，
 * 避免"关掉详情就看不到备注""下划线变空白节点"等问题回归。
 */

/** 文本会被拆成多个 AX 元素，取面积最大的节点本体做几何读数。 */
function largest(matches) {
  return matches.reduce((best, item) => {
    const area = item.size.width * item.size.height;
    return !best || area > best.size.width * best.size.height ? item : best;
  }, null);
}

function centerOf(item) {
  return { x: item.point.x + item.size.width / 2, y: item.point.y + item.size.height / 2 };
}

export default {
  id: "26b-mindmap-visual",
  title: "思维导图 · 视觉系统 · 浮动面板 · 元信息 · 长文本",
  area: "文件树 / 思维导图",
  steps: [
    {
      action: "新建导图并检查浮动详情不移动画布",
      ui: "新建内容 → 思维导图 → 创建 → 中心主题 → 主题检查器",
      clicks: 3,
      dialogs: 1,
      note: "详情是浮层而非布局列，打开后中心主题的屏幕坐标应保持不变。",
    },
    {
      action: "写入备注/标签/超链接/贴纸/标记并切换下划线",
      ui: "主题检查器 → 备注/标签/超链接 → 贴纸 idea → 优先级 1 → 星期 一 → 下划线",
      clicks: 6,
      dialogs: 0,
      note: "节点内联显示元信息；下划线只去掉上/左/右边框，不得变成空白节点。",
    },
    {
      action: "关闭详情后悬停读取全文并新增长文本子主题",
      ui: "收起详情 → 悬停中心主题 → Tab → 粘贴长文本 → 回车",
      clicks: 3,
      dialogs: 0,
      note: "备注与标记中文名从悬停卡读取；长文本自动折行扩宽，不溢出节点。",
    },
  ],
  async run(ctx) {
    const title = "E2E 视觉导图";
    const note = "这是一条用于验证悬停卡的备注";
    const longText =
      "这是一个用于验证节点在内容过多时能够自动扩宽并换行的很长很长很长很长很长的子主题文本";

    await ctx.press("新建内容");
    await ctx.expectText("创建");
    await ctx.fill("名称", title);
    await ctx.press("思维导图");
    await ctx.press("创建");
    await ctx.expectText("中心主题", { timeout: 15_000 });
    await ctx.screenshot("mindmap-visual-default");

    const before = largest((await ctx.find("中心主题")).matches);
    if (!before) throw new Error("找不到中心主题节点");
    const centerBefore = centerOf(before);
    await ctx.press("中心主题");
    await ctx.press("主题详情");
    await ctx.expectText("收起详情", { timeout: 5000 });
    await ctx.screenshot("mindmap-visual-inspector");
    const after = largest((await ctx.find("中心主题")).matches);
    const centerAfter = centerOf(after);
    const drift = Math.max(
      Math.abs(centerAfter.x - centerBefore.x),
      Math.abs(centerAfter.y - centerBefore.y),
    );
    if (drift > 6) throw new Error(`打开详情面板后画布中心偏移 ${drift.toFixed(1)}px`);
    ctx.log(`浮动详情打开前后中心偏移 ${drift.toFixed(1)}px`);

    await ctx.fill("备注", note);
    await ctx.fill("标签", "灵感, 待办");
    await ctx.fill("超链接", "https://example.com");
    await ctx.press("idea", { settle: 260 });
    await ctx.press("优先级 1", { settle: 260 });
    await ctx.press("星期 一", { settle: 260 });
    await ctx.expectText("打开链接", { timeout: 5000 });
    await ctx.screenshot("mindmap-visual-meta");

    await ctx.press("下划线");
    await ctx.screenshot("mindmap-visual-underline");

    await ctx.press("收起详情");
    await ctx.expectGone("收起详情", { timeout: 5000 });

    // 内容变宽后根主题水平中心必须留在原处（问题 15）；垂直方向正文按钮会为 chip 让位，
    // 节点中心不变量由 smoke「单根主题中心在原点」覆盖。
    const grown = centerOf(largest((await ctx.find("中心主题")).matches));
    const grownDriftX = Math.abs(grown.x - centerBefore.x);
    if (grownDriftX > 6) {
      throw new Error(`写入元信息后根主题水平中心漂移 ${grownDriftX.toFixed(1)}px`);
    }
    ctx.log(
      `元信息写入后根主题水平漂移 ${grownDriftX.toFixed(1)}px（垂直 ${(grown.y - centerBefore.y).toFixed(1)}px 为正文让位）`,
    );

    await ctx.hover("中心主题", "悬停中心主题读取备注");
    await ctx.expectText(note, { timeout: 5000 });
    await ctx.screenshot("mindmap-visual-hovercard");

    await ctx.press("中心主题");
    await ctx.key("tab", "创建子主题");
    await ctx.paste(longText, "输入长文本子主题");
    await ctx.key("return", "提交子主题");
    await ctx.expectText("已保存", { timeout: 10_000 });
    const longNode = largest((await ctx.find("这是一个用于验证节点")).matches);
    await ctx.screenshot("mindmap-visual-longtext");
    if (!longNode) throw new Error("找不到长文本子主题");
    // 量到的是节点内按钮宽度；用无元信息的根节点做基线，长文本必须明显更宽。
    if (longNode.size.width < before.size.width + 40) {
      throw new Error(`长文本节点未扩宽：${longNode.size.width}（根节点 ${before.size.width}）`);
    }
    ctx.log(`长文本节点尺寸 ${longNode.size.width}x${longNode.size.height}`);

    // 大纲是浮层：打开前后画布几何不动（问题 12）。用唯一工具栏做基准，
    // 避免“中心主题”同时出现在大纲行导致量错元素。
    const toolbarBefore = centerOf(largest((await ctx.find("导图编辑工具")).matches));
    await ctx.press("大纲视图");
    await ctx.expectText("大纲视图", { timeout: 8000 });
    await ctx.screenshot("mindmap-visual-outline");
    const toolbarAfter = centerOf(largest((await ctx.find("导图编辑工具")).matches));
    const outlineDrift = Math.max(
      Math.abs(toolbarAfter.x - toolbarBefore.x),
      Math.abs(toolbarAfter.y - toolbarBefore.y),
    );
    if (outlineDrift > 6) throw new Error(`打开大纲后画布中心偏移 ${outlineDrift.toFixed(1)}px`);
    await ctx.press("关闭大纲");

    const node = ctx.db("SELECT id FROM node WHERE title = ? AND type = 7", [title])[0];
    if (!node) throw new Error("思维导图节点未创建");
    await ctx.waitForDb(
      "SELECT content_json FROM mindmap_scene WHERE node_id = ?",
      [node.id],
      (rows) =>
        rows.length === 1 &&
        rows[0].content_json.includes(note) &&
        rows[0].content_json.includes("https://example.com") &&
        rows[0].content_json.includes("underline") &&
        rows[0].content_json.includes("priority-1") &&
        rows[0].content_json.includes("week-mon") &&
        rows[0].content_json.includes("idea"),
      { timeout: 12_000 },
    );
    ctx.log(`视觉导图 ${node.id} 的元信息、下划线与长文本布局已落库。`);
  },
};
