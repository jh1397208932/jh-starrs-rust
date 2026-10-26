import fs from "node:fs";
import path from "node:path";

/**
 * 工作区备份：更多菜单 → 备份当前工作区 → 选择目标目录 → 校验 DB/清单。
 */
export default {
  id: "91-backup",
  title: "工作区备份 · 数据库与附件对象",
  area: "备份 / 恢复",
  steps: [
    {
      action: "更多菜单打开备份与恢复",
      ui: "侧栏底部 → 备份与恢复",
      clicks: 1,
      dialogs: 1,
    },
    {
      action: "选择备份目标目录并等待完成",
      ui: "备份弹窗 → 备份当前工作区 → 系统目录选择",
      clicks: 2,
      dialogs: 1,
      note: "完成后显示备份路径。",
    },
    {
      action: "关闭弹窗并检查备份文件",
      ui: "备份弹窗 → 关闭",
      clicks: 1,
      dialogs: 0,
      note: "必须包含 backup.json 与 db/workspace.sqlite3。",
    },
  ],
  complexity: {
    clickTotal: 4,
    dialogs: 2,
    typingFields: 0,
    assessment:
      "备份是低频显式动作：入口在更多菜单，选择目标目录后一次完成；成功后直接显示备份路径，便于用户自己复制/搬移。恢复只允许空目录，避免覆盖现有工作区。",
  },
  async run(ctx) {
    const destination = ctx.exportDir("workspace-backup");
    await ctx.menu("更多 ⌘J", "备份与恢复");
    await ctx.expectText("备份当前工作区", { timeout: 5000 });
    await ctx.press("备份当前工作区");
    await ctx.nativePath(destination, { button: "Open" });
    await ctx.expectText("已备份到", { timeout: 20_000 });
    await ctx.screenshot("workspace-backup");
    await ctx.press("关闭");
    ctx.metrics.dialogs += 1;

    const entries = fs.readdirSync(destination, { withFileTypes: true });
    const backupRoot = entries.find(
      (entry) => entry.isDirectory() && entry.name.startsWith("starris-backup-"),
    );
    if (!backupRoot) throw new Error("未生成备份目录");
    const root = path.join(destination, backupRoot.name);
    if (!fs.existsSync(path.join(root, "backup.json"))) throw new Error("缺少 backup.json");
    if (!fs.existsSync(path.join(root, "db/workspace.sqlite3"))) {
      throw new Error("缺少工作区数据库");
    }
    ctx.log(`备份目录：${root}`);
  },
};
