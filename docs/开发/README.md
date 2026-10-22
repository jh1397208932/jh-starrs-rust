# 星屿 Starris 开发指南 · 总入口

> 面向人类开发者的导航。UI 规范见根目录 `UI-SPEC.md` 与 `docs/ui设计规范/DESIGN_TOKENS.md`；交互规格见 `docs/UX_SPEC.md`；AI 编码约定见 `AGENTS.md`。

## 当前阶段（2026-10-22）

工作区、知识库、文件树、用户记忆与**文档正文**均已接入 **Rust + SQLite 持久化**：

- 全局库 `~/.starris/rust/db/starris.db`：工作区注册表 + 记忆配置；日志在 `~/.starris/rust/logs/starris.log`。
- 每个本地工作区独立目录：`db/workspace.sqlite3` + `storage/`。
- 首次启动引导、工作区/知识库管理、任意层级文件树、5 类节点、拖拽换层/排序、主题/当前工作区/当前知识库记忆均已接入。
- 文档正文按顶层块内容寻址：`doc_block_hash` + `doc_block_tree`（工作区库 v3）；编辑后 1s 防抖保存，前端单飞互斥 + Rust 工作区互斥/事务；返回 `add/rm/order/tree` 差量。
- 编辑器接入 Tiptap 3.32 MIT 扩展：气泡菜单、右键浮层、Slash 菜单、颜色/高亮、对齐、表格、图片（≤2MB data URL）、任务列表、折叠块、Emoji、代码高亮、TOC、拖拽手柄。
- 画板/表格/流程图编辑器数据仍为后续范围；图片附件后端未接入。

## 快速上手

```bash
# 环境要求：Node 22+、Rust stable（Tauri v2）、Xcode CLT（macOS）
npm install
npm run tauri dev      # 桌面窗口开发（推荐；含真实 IPC/SQLite）
npm run dev            # 仅浏览器预览（无 Tauri IPC，会显示启动失败页；功能验证请用 tauri dev）
npm run check          # Biome 静态检查（src）
npm run check:licenses # 第三方许可证门禁（node_modules + Cargo + dist 字体）
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + vite build + 许可证门禁
cd src-tauri && cargo test      # Rust 集成测试
cd src-tauri && cargo clippy --all-targets
```

测试隔离：给 `STARRIS_HOME` 指向临时目录即可使用独立的全局库/日志，不触碰真实用户数据：

```bash
STARRIS_HOME=/tmp/starris-test npm run tauri dev
```

## 常见修改路径（要改 X，去哪里）

| 要改什么 | 位置 |
|---|---|
| 工作区生命周期/统一切换入口 | `src-tauri/src/services/workspace_service.rs` |
| 知识库业务 | `src-tauri/src/services/knowledge_base_service.rs` |
| 文件树层级/路径/排序/移动规则 | `src-tauri/src/services/node_service.rs` |
| 文档块保存/差量/引用清理 | `src-tauri/src/services/document_service.rs` |
| 内容哈希/块计划/排序键 | `src-tauri/src/domain/{document,block_plan,fractional_index}.rs` |
| Rust IPC 命令 | `src-tauri/src/commands/*.rs` |
| SQL 与表访问 | `src-tauri/src/repositories/*.rs` |
| 数据库迁移 | `src-tauri/src/db/{global,workspace}.rs` |
| 全局目录/路径安全 | `src-tauri/src/db/paths.rs` |
| 前端 IPC 封装 | `src/api/{workspace,knowledgeBase,node,memory,directory,document}.ts` |
| 文档加载/1s 防抖互斥保存 | `src/features/editor/hooks/useDocumentPersistence.ts` |
| 编辑器扩展与菜单 | `src/features/editor/extensions/editorExtensions.ts`、`components/{DocEditor,EditorBubbleMenu,EditorContextMenu,SlashMenu}.tsx` |
| 工作区/知识库/树状态 | `src/features/workspace/hooks/useWorkspaceStore.ts` |
| 主界面控制器/布局/弹窗 | `hooks/useWorkspaceMainController.ts`、`components/Workspace{Layout,Modals}.tsx` |
| 文件树与拖拽 | `components/FileTree.tsx`、`FileTreeRow.tsx`、`hooks/useFileTreeDrag.ts` |
| 编辑器与持久化 | `features/editor/components/DocEditor.tsx`、`hooks/useDocumentPersistence.ts` |
| 编辑器扩展 | `features/editor/extensions/editorExtensions.ts`、`clearMarksOnEnter.ts` |
| 文档元数据 | `src-tauri/src/services/document_meta_service.rs` + `doc_block_meta` |
| 颜色/主题/字号/圆角/动效 | `src/styles/tokens.css`（8 主题 × 深浅） |
| 主题记忆 | `src/lib/theme.tsx` + `src/api/memory.ts` |
| 窗口红绿灯/无边框策略 | `src-tauri/tauri.conf.json` + `src-tauri/src/lib.rs` + `components/common/TrafficLightSlot.tsx` |
| 快捷键 | `features/workspace/hooks/useWorkspaceShortcuts.ts` |

## 文档导航

- [架构说明](./架构说明.md)：分层、数据流、IPC 契约、统一切换不变量。
- [数据库设计与迁移](./数据库设计与迁移.md)：全局库/工作区库表结构、索引、迁移与删除安全。
- [第三方依赖许可证审查](./第三方依赖许可证审查.md)：Tiptap 等依赖许可结论、字体分发白名单与 `check:licenses` 门禁。
- [前端代码规范](./前端代码规范.md)：AGENTS.md §3 的展开细则。
- [代码结构与规范审查报告](./2026-10-20-代码结构与规范审查报告.md)：历史迁移记录。
- 当前需求：`docs/需求文档/2026-10-22-需求文档-编辑器交互重构.md`
- 当前任务：`docs/开发任务清单/2026-10-22-任务-004/`
- 当前测试：`docs/单元测试/2026-10-22-单元测试-文档规范化与元数据-001.md`、`docs/功能测试/2026-10-22-功能测试-编辑器交互重构-001.md`
- 历史：`docs/需求文档/2026-10-22-需求文档-编辑器块存储与交互增强.md`、`docs/开发任务清单/2026-10-22-任务-003/`、`docs/需求文档/2026-10-21-需求文档-本地工作区与文件树.md`、`docs/开发任务清单/2026-10-21-任务-005/`
