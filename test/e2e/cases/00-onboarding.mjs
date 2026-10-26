import assert from "node:assert/strict";

/**
 * 首次启动到可工作的最小路径：
 * 欢迎页 → 新建工作区 → 默认知识库。
 */
export default {
  id: "00-onboarding",
  title: "首次启动 · 创建本地工作区 · 默认知识库",
  area: "启动引导 / 工作区",
  steps: [
    {
      action: "确认欢迎页及「新建工作区 / 打开工作区」入口",
      ui: "窗口居中引导面板",
      clicks: 0,
      dialogs: 0,
      note: "首次启动无当前工作区时出现。",
    },
    {
      action: "点击「新建工作区」",
      ui: "引导面板左侧主卡片",
      clicks: 1,
      dialogs: 1,
      note: "打开创建工作区弹窗。",
    },
    {
      action: "填写空间名称与目标文件夹绝对路径",
      ui: "创建工作区弹窗：名称输入框、位置输入框",
      clicks: 0,
      dialogs: 0,
      note: "路径必须为空目录或不存在；测试使用项目 tmp 下目录。",
      typing: 2,
    },
    {
      action: "点击「创建」",
      ui: "弹窗右下主按钮",
      clicks: 1,
      dialogs: 0,
      note: "后端创建 db/、storage/ 与默认知识库。",
    },
    {
      action: "确认侧栏出现默认知识库",
      ui: "左侧侧栏文件树",
      clicks: 0,
      dialogs: 0,
    },
  ],
  complexity: {
    clickTotal: 2,
    dialogs: 1,
    typingFields: 2,
    assessment:
      "首次启动路径清晰，2 次点击 + 2 个字段即可进入主界面；目标文件夹必须手动输入绝对路径，若从最近的目录/「选择…」直接落到推荐目录会更省一步。",
  },
  async run(ctx) {
    await ctx.expectText("欢迎使用星屿");
    await ctx.expectText("新建工作区");
    await ctx.screenshot("onboarding");

    await ctx.press("新建工作区");
    await ctx.expectText("创建工作区");
    // 等弹窗打开后的重置 effect 完成，避免它清掉随后填入的路径/名称。
    await new Promise((resolve) => setTimeout(resolve, 300));

    const readPath = async () => {
      const field = (await ctx.find("选择文件夹", { role: "AXTextField" })).matches[0];
      return field?.value ?? "";
    };
    let pathValue = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await ctx.fill("选择文件夹", ctx.workspacePath);
      pathValue = await readPath();
      if (pathValue === ctx.workspacePath) break;
    }
    if (pathValue !== ctx.workspacePath) {
      throw new Error(`工作区路径填写异常：期望 ${ctx.workspacePath}，实际 ${pathValue}`);
    }
    await ctx.fill("名称", "E2E 工作区");
    await ctx.expectText("创建");
    await ctx.press("创建");

    await ctx.expectText("默认知识库", { timeout: 30_000 });
    await ctx.expectText("更多", { timeout: 10_000 });
    await ctx.screenshot("workspace-created");

    ctx.assertFile("db/workspace.sqlite3");
    const kbs = ctx.db("SELECT name FROM knowledge_base ORDER BY name");
    assert.equal(kbs.length, 1, `默认知识库数量应为 1，实际 ${kbs.length}`);
    assert.equal(kbs[0].name, "默认知识库");
    ctx.log(`工作区：${ctx.workspacePath}`);
  },
};
