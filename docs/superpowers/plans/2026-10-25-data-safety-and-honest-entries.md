# 数据安全与入口诚实化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 R01/R02/R03/R22 与批次 0，让关闭不丢字、旧库可回滚、并发不静默覆盖、入口不说谎。

**Architecture:** 前端在窗口/应用退出事件中 flush 活动持久化；Rust 用 `RunEvent::ExitRequested` 协调退出，并在旧库迁移前复制数据库。文档保存引入 `doc_version` 乐观锁；入口诚实化仅改展示与入口，不动数据。

**Tech Stack:** Tauri 2.12.4、React 19、TypeScript、Rust、SQLite（rusqlite bundled）、FTS 未在本批使用。

**Spec:** `docs/需求文档/2026-10-25-需求文档-数据安全与入口诚实化.md`

## Global Constraints

- 不引入新依赖；不修改 Excalidraw 源码。
- 不删除真实节点/附件；入口诚实化只改展示。
- 所有新增代码/注释/文档使用简体中文。
- SQL 参数化；schema 变更走 `PRAGMA user_version` 迁移。
- 提交前 `cargo test`、`clippy -D warnings`、`fmt --check`、`npm run check/typecheck/build` 全绿。

---

### Task 1: schema v11 + 迁移备份

**Files:**
- Modify: `src-tauri/src/db/workspace.rs`
- Test: `src-tauri/src/db/workspace.rs` tests + `src-tauri/src/integration_tests.rs`

**Steps:**
- [ ] 写失败测试：v10 库打开后生成 `db/backups/*.sqlite3`，数据完整；v11 不备份；连续升级保留 3 份。
- [ ] 运行 `cargo test migrates_v9_to_v10_and_backfills_attachment_refs -- --nocapture`，确认失败（尚无备份）。
- [ ] `SCHEMA_VERSION=11`，加 `MIGRATION_V10_TO_V11`（`ALTER TABLE node ADD COLUMN doc_version INTEGER NOT NULL DEFAULT 0`）。
- [ ] `open` 读取版本，调用 `backup_before_migrate(path, version)`；`wal_checkpoint(TRUNCATE)` + `fs::copy`；失败返回 `AppError::FileSystem`；保留 3 份。
- [ ] 迁移测试断言 `user_version=11`，`doc_version=0`，备份可打开。
- [ ] 运行全部 `cargo test`。

### Task 2: 文档版本冲突

**Files:**
- Modify: `src-tauri/src/models/document.rs`、`repositories/document_repository.rs`、`services/document_service.rs`、`integration_tests.rs`
- Modify: `src/types/document.ts`、`src/api/document.ts`、`src/features/editor/hooks/useDocumentPersistence.ts`、`src/features/editor/components/DocEditor.tsx`

**Steps:**
- [ ] 写失败集成测试：连续两次用同一个 `base_version` 保存，第二次返回 `AppError::Conflict`。
- [ ] Rust：`SaveDocumentInput.base_version`、`DocLoadResult.version`、`DocSaveResult.version`；`DocumentNodeRow.doc_version`；`update_content` 原子递增并返回新版本。
- [ ] `save` 在事务内比较 `node.doc_version != input.base_version`，冲突返回中文错误。
- [ ] `TestEnv::save_doc` 先 load 当前版本，测试辅助自动传入。
- [ ] 前端：类型加 `version`；`saveDocument(nodeId, document, baseVersion)`；持久化器维护 `baseVersionRef`，`setBaseline(..., version)`；冲突走 `onError` 并保留 dirty。
- [ ] `DocEditor` 加载时传 `loaded.version`；冲突提示"文档已在别处更新，请重新加载"。
- [ ] 运行 Rust/TS 测试。

### Task 3: 关闭/退出保存

**Files:**
- Create: `src-tauri/src/commands/app.rs`
- Modify: `src-tauri/src/lib.rs`、`src-tauri/src/commands/mod.rs`
- Create: `src/api/app.ts`、`src/features/workspace/hooks/useAppCloseGuard.ts`
- Modify: `src/features/workspace/hooks/useWorkspaceMainController.ts`

**Steps:**
- [ ] 写失败测试：`app_confirm_exit` 设置允许标志（纯函数测试）；前端 hook 的类型检查。
- [ ] Rust：`AtomicBool EXIT_ALLOWED`；`app_confirm_exit` 设置并 `app.exit(0)`；`lib.rs` 改 `.build().run(|app,event| ...)`，`ExitRequested` 未允许时 prevent + emit `starris://exit-requested`；emit 失败允许退出。
- [ ] 前端：`onExitRequested` 监听、`confirmAppExit`、`onWindowCloseRequested` 封装；hook 调 `flushActivePersistence`，8 秒超时，失败 toast；成功确认退出。
- [ ] 主控制器调用 `useAppCloseGuard(showToast)`。
- [ ] 编译、类型检查；浏览器 dev 降级不崩溃。

### Task 4: 入口诚实化

**Files:** `WindowBar.tsx`、`DocPageBar.tsx`、`SettingsDialog.tsx`、`InfoPanel.tsx`、`StarredList.tsx`、`NodeCreateDialog.tsx`、`MOCK_RELATED`/`MOCK_OUTLINE` removal、`useWorkspaceMainController.ts`。

**Steps:**
- [ ] 写 E2E 断言：搜索/打印禁用；语言禁用；相关无假数据；新建无表格/流程图；收藏空页无假按钮。
- [ ] 改组件与主控制器；删除 mock 常量；保留已有节点占位页。
- [ ] 跑 `npm run check/typecheck`。

### Task 5: 维护互斥

**Files:** `src-tauri/src/services/attachment_maintenance_service.rs`、`integration_tests.rs`

**Steps:**
- [ ] 写并运行并发测试（同 hash 上传 + 维护），确认当前行为；若无法复现，保留压力测试。
- [ ] 把 big unlink 移到 `drop(lock)` 前；unlink 前重新查询 blob 是否仍不存在；pack compaction 保持锁外。
- [ ] 跑附件生命周期全部测试。

### Task 6: 验证与收尾

- [ ] `cargo test`、`cargo clippy --all-targets -- -D warnings`、`cargo fmt --check`。
- [ ] `npm run check`、`npm run typecheck`、`npm run build`。
- [ ] `npm run test`（真机 E2E）。
- [ ] 更新任务记录、文件清单、更新日志、开发指南、UI-SPEC、测试报告。
- [ ] 提交（用户已要求实施；提交前先报告变更）。
