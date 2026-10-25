# 单元测试 · 画板与组件库服务

- 日期：2026-10-24
- 关联需求：`docs/需求文档/2026-10-24-需求文档-画板功能.md`
- 关联任务：`docs/开发任务清单/2026-10-24-任务-002/`
- 被测模块：`src-tauri/src/services/board_service.rs`、`src-tauri/src/services/library_service.rs`、`src-tauri/src/db/workspace.rs`（迁移）
- 测试环境：macOS Darwin 24.6.0 / arm64；Rust `cargo test`；临时目录中的真实 SQLite 工作区库
- 执行命令与结果：

```bash
cd src-tauri
cargo test
# running 68 tests
# test result: ok. 68 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.71s
```

## 用例

### UT-BOARD-01 `board_scene_roundtrip_filters_deleted_and_guards_version`

- 目标：保存/加载往返、删除元素过滤、元素计数与乐观版本冲突。
- 前置：临时工作区 + `type = 3` 画板节点。
- 步骤：保存含 `isDeleted` 元素的场景 → 加载比对；用旧 `baseVersion` 再次保存。
- 期望：加载返回非删除元素与 appState；`element_count` 由后端计算；旧版本返回冲突且不覆盖。
- 实际：通过。
- 关联文件：`src-tauri/src/integration_tests.rs:2167`。

### UT-BOARD-02 `board_images_use_global_object_ids_and_report_missing_objects`

- 目标：图片 `fileId` 直接使用全局对象 id；对象缺失时返回 `missingObjectIds` 且不阻断加载。
- 前置：工作区附件对象 + 引用该 id 的 image 图元。
- 步骤：保存 → 读取；删除对象后再次加载。
- 期望：`files` 以 object_id 为键；缺失 id 出现在 `missingObjectIds`，画板元素仍返回。
- 实际：通过。
- 关联文件：`src-tauri/src/integration_tests.rs:2236`。

### UT-LIB-01 `library_seeds_presets_imports_and_toggles`

- 目标：预设幂等 seed、社区库导入、启用/停用、预设不可删、导入库可删。
- 前置：临时工作区；自定义 `.excalidrawlib` 文件。
- 步骤：列库 → 导入自定义库 → 停用「基础形状」→ 删除预设（期望失败）→ 删除导入库。
- 期望：预设数量 ≥ 7；导入组件数正确；停用后可用组件减少；删除预设报校验错误；删除导入库同时清空其组件。
- 实际：通过。
- 关联文件：`src-tauri/src/integration_tests.rs:2329`。

### UT-MIG-01 `migrates_v1_timestamp_columns_and_keeps_data`

- 目标：旧 v1 库迁移后结构升级且不丢节点数据。
- 期望：`PRAGMA user_version = 9`；旧节点行保留。
- 实际：通过。
- 关联文件：`src-tauri/src/db/workspace.rs:415`。

### UT-MIG-02 `migrates_v6_blob_rows_to_v7_without_losing_objects`

- 目标：v6 附件 blob 迁移到对象表，再升级到 v9。
- 期望：`user_version = 9`；附件对象行与哈希保留。
- 实际：通过。
- 关联文件：`src-tauri/src/db/workspace.rs:568`。

## 未覆盖与说明

- 自动保存的去抖/最长等待/单飞/失败退避属于前端 `useBoardPersistence` 调度逻辑，本轮由浏览器 mock 与真机黑盒覆盖，未写 fake timer 单元测试。真机日志另外验证了写库次数：打开画板 0 次、单次变更 1 次（修复前为双写）。
- 文件卡片双击打开、对象删除后的缺失提示 UI 为已知未实现项，不在本次断言范围。
- 测试使用真实 SQLite 临时库，不是内存桩；迁移用例保留旧表数据。
