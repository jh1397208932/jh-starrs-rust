# 星屿 Starris 开发指南 · 总入口

> 面向人类开发者的导航。UI 规范见根目录 `UI-SPEC.md` 与 `docs/ui设计规范/DESIGN_TOKENS.md`；交互规格见 `docs/UX_SPEC.md`；AI 编码约定见 `AGENTS.md`。
>
> 2026-10-31 新增：Windows 编译与窗口适配、图表总览、环境安装与运行指南。

## 当前阶段（2026-10-31）

工作区、知识库、文件树、用户记忆与**文档正文**均已接入 **Rust + SQLite 持久化**：

- 全局库 `~/.starris/rust/db/starris.db`：工作区注册表 + 记忆配置；日志在 `~/.starris/rust/logs/starris.log`。
- 每个本地工作区独立目录：`db/workspace.sqlite3` + `storage/`。
- 首次启动引导、工作区/知识库管理、任意层级文件树、6 类节点（文件夹/文档/画板/表格/流程图/附件）、拖拽换层/排序、主题/当前工作区/当前知识库记忆均已接入。
- 文档正文按顶层块内容寻址：`doc_block_hash` + `doc_block_tree`（工作区库 v5）；编辑后 1s 防抖保存，前端单飞互斥 + Rust 工作区互斥/事务；返回 `add/rm/order/tree` 差量；`doc_block_meta` 异步派生 Markdown/prop。
- 附件对象存储：`attachment/attachment_blob/attachment_pack`；BLAKE3 内容寻址、big 原子发布、small pack、去重、软删除/回收站与后台 compaction。工作区库 v10 新增 `node_attachment` 引用表与 `scope/expires_at/orphaned_at`；文档/画板保存同步引用，节点删除标记孤儿，看门狗每 6 小时清理 staging/TTL/孤儿/回收站并压缩 pack。
- 附件节点：type=6，文件树可直接多选上传；附件标签页支持图片预览、元数据与下载；整库导出写到树对应位置并记录 `attachmentNodes`。设置 → 存储页支持关联数、实际占用、回收站恢复与立即清理。
- 文档图片/附件块：`attachmentImage`（预览、左/中/右对齐、宽度缩放、下载）与 `attachmentBlock`（卡片/长条、文件类型图标、逐项下载/移除）；Slash/右键选文件与访达拖入走路径流式上传，剪贴板粘贴走 raw 字节上传，统一进入附件对象模块，文档 JSON 不写 base64。注意 `dragDropEnabled` 默认为 true，外部文件拖放不经过网页 `drop`，由 `src/api/dragDrop.ts` 订阅 webview 事件。
- 编辑器接入 Tiptap 3.32 MIT 扩展：气泡菜单、右键浮层、Slash 菜单、颜色/高亮、对齐、表格、图片（≤2MB data URL）、任务列表、折叠块、Emoji、代码高亮、TOC；块手柄与拖拽为自绘实现（不依赖官方 DragHandle）。
- 画板已接入 Excalidraw 场景/视口持久化、组件库与三格式导出；表格复用文档编辑器，流程图复用画板编辑器，均已完成节点与页头接入。编辑器内图片/附件已走全局对象库。
- 快捷键：应用/编辑器/画板三作用域，配置存全局 `shortcuts.config`；支持总开关、录制、冲突检测与恢复默认。应用动作走注册表，编辑器走 ProseMirror keymap，画板自有动作走 Excalidraw 公共 API；原生画板键位只读。
- 平台适配（2026-10-31）：macOS 保留系统红绿灯与原生菜单；Windows/Linux 使用无边框窗口 + 自绘 `WindowControls`（46×32，最大化状态随 resize 同步），并新增侧栏顶部拖拽带；所有快捷键文案经 `lib/platform.ts` 统一转成 Ctrl/Alt/Shift；Tauri 配置按平台拆分为 `tauri.macos.conf.json` / `tauri.windows.conf.json`，Windows 打包目标为 NSIS。
- Windows 文件与路径：`db/paths.rs` 输出前还原 `\\?\` verbatim 前缀；空目录判定忽略 `.DS_Store` / `Thumbs.db` / `desktop.ini`；附件磁盘可用空间改用 `GetDiskFreeSpaceExW`；保存对话框默认文件名统一清理 Windows 非法字符与保留名。

## 快速上手

```bash
# 环境要求：Node 22+、Rust stable（Tauri v2）；Windows 需 MSVC + Windows SDK，macOS 需 Xcode CLT
npm install
cargo fetch --manifest-path src-tauri/Cargo.toml   # 首次：缓存全平台依赖，供许可证门禁离线扫描
npm run tauri dev      # 桌面窗口开发（推荐；含真实 IPC/SQLite）
npm run dev            # 仅浏览器预览（无 Tauri IPC，会显示启动失败页；功能验证请用 tauri dev）
npm run check          # Biome 静态检查（src，lineEnding: auto）
npm run check:licenses # 第三方许可证门禁（node_modules + Cargo + dist 字体）
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + vite build + 许可证门禁
npm run test           # 真机黑盒全量功能测试（macOS AX/CGEvent；会启动 Tauri 窗口）
npm run test:backend   # Rust 集成测试
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

> Windows 打包命令为 `npm run package:win`（NSIS `.exe`）；macOS 为 `npm run package:dmg`。完整环境准备与排错见 [环境安装与运行](./环境安装与运行.md)。

> 黑盒测试要求 macOS + Xcode CLT + 终端辅助功能权限，且没有其他星屿实例占用窗口。测试工作区在项目 `tmp/e2e/<运行时间>/`，输入 fixtures 在 `test/fixtures/files/`；详见 `test/README.md` 与 `docs/功能测试/2026-10-25-黑盒全量功能测试与合理性分析.md`。测试隔离：给 `STARRIS_HOME` 指向临时目录即可使用独立的全局库/日志，不触碰真实用户数据：

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
| 前端 IPC 封装 | `src/api/{workspace,knowledgeBase,node,memory,document,attachment,directory,fileDialog}.ts` |
| 文档加载/1s 防抖互斥保存 | `src/features/editor/hooks/useDocumentPersistence.ts` |
| 单文档 / 整库导出 | `src-tauri/src/services/export_service.rs`、`export_render.rs`；前端 `api/exchange.ts`、`ShareExportDialog.tsx`、`ExportKnowledgeBaseDialog.tsx` |
| Markdown / Word 导入 | `src-tauri/src/services/import_service.rs`、`import_markdown.rs`、`import_word.rs`；前端 `ImportDialog.tsx` |
| 编辑器扩展与菜单 | `src/features/editor/extensions/editorExtensions.ts`、`components/{DocEditor,EditorBubbleMenu,EditorContextMenu,SlashMenu}.tsx` |
| 工作区/知识库/树状态 | `src/features/workspace/hooks/useWorkspaceStore.ts` |
| 主界面控制器/布局/弹窗 | `hooks/useWorkspaceMainController.ts`、`components/Workspace{Layout,Modals}.tsx` |
| 文件树与拖拽 | `components/FileTree.tsx`、`FileTreeRow.tsx`、`hooks/useFileTreeDrag.ts` |
| 编辑器与持久化 | `features/editor/components/DocEditor.tsx`、`hooks/useDocumentPersistence.ts` |
| 编辑器扩展 | `features/editor/extensions/editorExtensions.ts`、`clearMarksOnEnter.ts` |
| 文档元数据 | `src-tauri/src/services/document_meta_service.rs` + `doc_block_meta` |
| 附件对象存储（哈希/pack/压缩） | `src-tauri/src/services/{attachment_service,attachment_store}.rs` |
| 附件引用同步/孤儿/生命周期 | `src-tauri/src/services/{attachment_reference_service,attachment_maintenance_service}.rs`、`repositories/node_attachment_repository.rs` |
| 附件表/统计/回收站 SQL | `src-tauri/src/repositories/attachment_repository.rs` |
| 附件节点/树上传/附件页 | `src-tauri/src/services/node_service.rs`、`src/features/attachments/components/AttachmentNodeView.tsx`、`src/features/workspace/components/{FileTree,FileTreeRow}.tsx` |
| 附件设置页 | `src/features/attachments/**` + `src/api/{attachment,fileDialog}.ts` |
| 文档图片/附件块 | `src/features/editor/extensions/{attachmentImage,attachmentBlock}.ts` + `components/nodes/*`；上传与落点 `utils/attachmentUpload.ts`；外部拖放 `src/api/dragDrop.ts` |
| 文件类型图标 | `src/features/attachments/components/FileTypeIcon.tsx` + `utils/fileKind.ts` |
| 编辑器上传/插入 | `src/features/editor/utils/attachmentUpload.ts` |
| 颜色/主题/字号/圆角/动效 | `src/styles/tokens.css`（9 主题 × 深浅） |
| 主题记忆 | `src/lib/theme.tsx` + `src/api/memory.ts` |
| 窗口红绿灯 / 无边框 / 平台配置 | `src-tauri/tauri.{macos,windows}.conf.json` + `src-tauri/src/lib.rs` + `components/common/TrafficLightSlot.tsx` + `features/workspace/components/WindowControls.tsx` |
| Windows 窗口控制与键帽文案 | `features/workspace/components/WindowControls.tsx`、`lib/platform.ts`、`lib/window.ts` |
| 平台路径 / 空目录 / 磁盘空间 | `src-tauri/src/db/paths.rs`、`services/workspace_service.rs`、`services/attachment_service.rs` |
| 快捷键动作表/配置/录制 UI | `src/features/shortcuts/**` |
| 应用/编辑器/画板快捷键分发 | `features/workspace/hooks/useWorkspaceShortcuts.ts`、`features/editor/extensions/userKeymap.ts`、`features/board/hooks/useBoardKeymap.ts` |

## 文档导航

- [图表总览](./图表总览.md)：系统架构、启动/切换/保存/退出时序、附件生命周期、ERD、导入导出、平台窗口与质量门禁图；**跨模块图表以这里为准**。
- [环境安装与运行](./环境安装与运行.md)：Windows/macOS 环境准备、开发运行、打包、质量门禁与常见问题。
- [架构说明](./架构说明.md)：分层、数据流、IPC 契约、统一切换不变量与平台适配说明。
- [数据库设计与迁移](./数据库设计与迁移.md)：全局库/工作区库表结构、索引、迁移与删除安全。
- [第三方依赖许可证审查](./第三方依赖许可证审查.md)：Tiptap 等依赖许可结论、字体分发白名单与 `check:licenses` 门禁。
- [前端代码规范](./前端代码规范.md)：AGENTS.md §3 的展开细则。
- [代码结构与规范审查报告](./2026-10-20-代码结构与规范审查报告.md)：历史迁移记录。
- 当前需求：`docs/需求文档/2026-10-31-需求文档-Windows适配与开源文档.md`
- 当前任务：`docs/开发任务清单/2026-10-31-任务-001/`
- 当前测试：`docs/功能测试/2026-10-31-功能测试-Windows适配-001.md`、`docs/单元测试/2026-10-31-单元测试-平台路径与窗口依赖-001.md`；macOS AX 套件见 `docs/功能测试/2026-10-25-黑盒全量功能测试与合理性分析.md`
- 平台设计产物：`docs/设计/2026-10-31-Windows适配-001/`
- 历史：`docs/需求文档/2026-10-22-需求文档-编辑器交互重构.md`、`docs/开发任务清单/2026-10-22-任务-004/`、`docs/需求文档/2026-10-21-需求文档-本地工作区与文件树.md`、`docs/开发任务清单/2026-10-21-任务-005/`
