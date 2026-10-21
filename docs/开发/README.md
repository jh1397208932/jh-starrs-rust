# 星屿 Starris 开发指南 · 总入口

> 面向人类开发者的导航。UI 规范见根目录 `UI-SPEC.md` 与 `docs/DESIGN_TOKENS.md`；交互规格见 `docs/UX_SPEC.md`；AI 编码约定见 `AGENTS.md`。

## 当前阶段

纯前端 mock 阶段：全部数据来自 `src/mocks/*.ts` 常量，无后端调用、无持久化。Rust 侧仅承担窗口生命周期（无边框/红绿灯策略）。

## 快速上手

```bash
# 环境要求：Node 22+、Rust stable（tauri v2）、Xcode CLT（macOS）
npm install          # 安装前端依赖（pnpm 迁移说明见 AGENTS.md §1 例外记录）
npm run dev          # 浏览器开发预览（http://localhost:1420）
npm run tauri dev    # 桌面窗口开发（macOS 红绿灯/无边框策略在此验证）
npm run check        # biome 静态检查（src 目录）
npm run build        # tsc + vite 生产构建
npm run tauri build  # 桌面打包
```

## 常见修改路径（要改 X，去哪里）

| 要改什么 | 位置 |
|---|---|
| 颜色/主题/字号/圆角/动效 | `src/styles/tokens.css`（8 主题 × 深浅，shadcn/ui 命名） |
| 布局结构（侧栏/窗口栏/浮窗） | `src/App.tsx`（组装）+ `src/components/layout/*` |
| 标签页行为 | `src/components/layout/WindowBar.tsx` |
| 侧栏树/更多菜单 | `src/components/layout/Sidebar.tsx` + `src/components/dialogs/MoreMenu.tsx` |
| 文档编辑器 / slash 命令 | `src/components/editor/DocEditor.tsx`、`SlashMenu.tsx` |
| 画板 | `src/components/board/BoardView.tsx`（excalidraw 懒加载） |
| 弹窗（设置/创建工作空间/知识库管理等） | `src/components/dialogs/*` |
| mock 数据 | `src/mocks/workspace.ts`、`shortcuts.ts` |
| 主题切换逻辑 | `src/lib/theme.tsx`（写 html 的 data-theme/data-mode） |
| 红绿灯/无边框窗口策略 | `src-tauri/tauri.conf.json` + `src-tauri/src/lib.rs` + `components/common/TrafficLightSlot.tsx` |
| 快捷键 | `src/App.tsx` 的 keyHandler + `src/mocks/shortcuts.ts` |

## 架构与目录

详见 `架构说明.md`。当前目录与 AGENTS.md §2 目标结构的对齐状态：

- ✅ `components/ui`（shadcn 风格基础件）、`components/common`（跨模块共用件）、`lib`、`styles`、`docs`
- 🕐 待功能落地时演进：`features/<功能>/`（按功能分包）、`api/`（IPC 封装层）、Rust 侧 `commands/services/domain/repositories` 分层——迁移时按 §2「逐步靠拢」执行并在任务记录中写明范围
