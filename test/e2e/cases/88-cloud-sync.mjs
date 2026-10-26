import fs from "node:fs";
import path from "node:path";

/**
 * 云同步：选择同步文件夹 → 上传完整快照 → 快照落盘。
 * 恢复动作会切换工作区，放在 Rust 集成测试中验证，避免打断后续用例。
 */
export default {
  id: "88-cloud-sync",
  title: "云同步 · 连接同步文件夹 · 上传快照",
  area: "设置 / 云同步",
  steps: [
    {
      action: "打开设置 → 云同步",
      ui: "更多 → 设置 → 左侧「云同步」",
      clicks: 2,
      dialogs: 1,
    },
    {
      action: "填写并连接同步文件夹",
      ui: "同步文件夹输入框 + 连接",
      clicks: 1,
      dialogs: 0,
      typing: 1,
    },
    {
      action: "立即同步",
      ui: "云同步面板「立即同步」",
      clicks: 1,
      dialogs: 0,
      note: "生成完整工作区快照并显示最新快照时间。",
    },
  ],
  complexity: {
    clickTotal: 4,
    dialogs: 1,
    typingFields: 1,
    assessment:
      "同步文件夹只需连接一次；之后「立即同步」一键上传，恢复在另一台设备上选空文件夹即可。没有账号体系，也不在后台偷偷改写文件，符合本地优先。",
  },
  async run(ctx) {
    const syncDir = ctx.exportDir("cloud-sync");
    fs.mkdirSync(syncDir, { recursive: true });

    // 快捷键用例可能留下设置弹窗；先关掉再走真实入口。
    await ctx.key("escape");
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.expectText("通用");
    await ctx.press("云同步");
    await ctx.expectText("选择云盘里的同步文件夹，手动上传或恢复完整工作区。", { timeout: 5000 });
    await ctx.fill("同步文件夹", syncDir);
    await ctx.press("连接");
    await ctx.expectText("已连接", { timeout: 8000 });
    await ctx.press("立即同步");
    await ctx.expectText("已同步", { timeout: 30_000 });
    await ctx.expectText("最新快照", { timeout: 8000 });
    await ctx.screenshot("cloud-sync");

    const snapshots = fs
      .readdirSync(syncDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("starris-backup-"));
    if (snapshots.length === 0) throw new Error("同步文件夹中没有生成快照");
    const snapshot = path.join(syncDir, snapshots[0].name);
    if (!fs.existsSync(path.join(snapshot, "backup.json"))) {
      throw new Error("快照缺少备份清单");
    }
    if (!fs.existsSync(path.join(snapshot, "db/workspace.sqlite3"))) {
      throw new Error("快照缺少工作区数据库");
    }
    await ctx.press("完成");
    ctx.log(`云同步快照：${snapshot}`);
  },
};
