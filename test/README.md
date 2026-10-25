# test/ · 星屿真机黑盒测试

`pnpm run test` 启动真实 Tauri 窗口，用 macOS Accessibility + CGEvent 模拟用户操作，并通过真实 SQLite / 文件系统断言结果。

## 前置条件

- macOS；安装 Xcode Command Line Tools（首次运行会用 `swiftc` 编译 `test/e2e/native/axhelper.swift`）。
- 为运行 `pnpm run test` 的终端/Qoder 授予“系统设置 → 隐私与安全性 → 辅助功能”权限。
- 没有其他星屿实例在运行，且 `localhost:1420` 空闲；运行器检测到已有实例会直接拒绝。
- 使用 `pnpm`（当前 10.18.0）。不需要新增 JS 依赖。

## 命令

```bash
pnpm run test                 # 全量黑盒用例
pnpm run test -- --case=doc   # 只跑 id/title/area 包含 doc 的用例（仍建议从全量跑）
pnpm run test -- --keep       # 保留应用运行，便于查看现场（不会自动清理）
pnpm run test:backend         # Rust 集成测试（非黑盒）
```

运行产物：`tmp/e2e/<timestamp>/`

```text
tmp/e2e/<timestamp>/
├── home/                  # STARRIS_HOME（全局库、日志）
├── workspace/             # 本次测试工作区（db/、storage/）
├── exports/               # 文档/画板/全部导出/附件导出
├── screenshots/           # 每个用例关键步骤 + 失败现场
├── app.log                # Tauri dev 日志
├── report.md / report.json
└── bin/axhelper           # 编译出的原生辅助程序
```

`tmp/e2e/latest` 指向最近一次运行。`tmp/` 已在 `.gitignore` 中。

## 目录与扩展

```text
test/
├── e2e/
│   ├── run.mjs
│   ├── harness.mjs
│   ├── native/axhelper.swift
│   └── cases/
│       ├── index.mjs
│       ├── 00-onboarding.mjs
│       ├── 10-shell.mjs
│       ├── 20-tree.mjs
│       ├── 30-doc.mjs
│       ├── 40-board.mjs
│       ├── 50-settings.mjs
│       ├── 60-library.mjs
│       ├── 70-import-export.mjs
│       ├── 80-shortcuts.mjs
│       ├── 90-workspace-kb.mjs
│       ├── 95-interactions.mjs
│       └── 96-misc.mjs
└── fixtures/files/        # sample.md / sample.excalidraw / sample.excalidrawlib / pixel.png
```

新增用例：

1. 新建 `test/e2e/cases/NN-<area>.mjs`：
   ```js
   export default {
     id: "NN-area",
     title: "功能标题",
     area: "功能域",
     steps: [
       { action: "点击…", ui: "页面/按钮位置", clicks: 1, dialogs: 0, note: "期望" },
     ],
     complexity: { clickTotal: 1, dialogs: 0, typingFields: 0, assessment: "合理性判断" },
     async run(ctx) { /* ctx.* 操作 */ },
   };
   ```
2. 在 `test/e2e/cases/index.mjs` 登记（顺序即运行顺序）。
3. 需要的输入文件放到 `test/fixtures/files/`，用 `ctx.fixture("name")` 取绝对路径。

`steps` 与 `complexity.assessment` 会自动写入运行报告；实际点击/按键/输入/对话框计数由框架统计。

## 常用上下文 API

| 方法 | 用途 |
|---|---|
| `ctx.press(text,{role})` / `ctx.menu(trigger,item)` | AX 查找并按下；菜单自动处理 Radix 触发器的指针要求 |
| `ctx.fill(query,text)` / `ctx.key(combo)` / `ctx.click(x,y)` / `ctx.drag(...)` | 输入、快捷键、坐标点击/拖拽 |
| `ctx.nativePath(path,{button})` | 系统打开/保存面板的 Cmd+Shift+G 路径输入与按钮确认 |
| `ctx.expectText/expectGone/waitForText` | UI 文本与消失等待 |
| `ctx.waitForDb/globalDb` | 真实 SQLite 断言/轮询 |
| `ctx.waitForPath/assertFile` | 文件断言 |
| `ctx.screenshot(name)` | 截取当前窗口并归档 |
| `ctx.finding(severity,title,detail)` | 记录测试发现（不影响 PASS/FAIL） |

## 约定与限制

- 用例按注册顺序运行；00 创建全新工作区，20 创建 `E2E Folder Renamed / E2E Doc / E2E Board`，25 创建附件节点，70 依赖 25 的附件节点验证导出，85/87 验证快捷键配置，后续用例依赖这些数据。需要独立运行某个用例时，先跑全量或自备前置步骤。
- 每次运行从零工作区开始，固定输入在 `test/fixtures/files/`；测试删除只针对本轮 `tmp/` 数据。
- 原生文件面板用 ASCII 的 `tmp/...` 路径导航；中文路径无法可靠通过 System Events 输入，这是测试工具限制，不是应用限制。
- 无头/未授权环境会失败并给出原因；不会把未执行的用例标为通过。
- 当前覆盖边界与发现见 `docs/功能测试/2026-10-25-黑盒全量功能测试与合理性分析.md`。
