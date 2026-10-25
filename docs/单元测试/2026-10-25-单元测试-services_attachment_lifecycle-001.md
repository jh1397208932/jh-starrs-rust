# 单元测试 · 附件引用与对象生命周期（2026-10-25）

- 关联任务：`docs/开发任务清单/2026-10-25-任务-004/`
- 被测模块：`db::workspace`、`domain::attachment_refs`、`services::attachment_service`、`services::attachment_maintenance_service`、`services::document_service`、`services::board_service`、`services::node_service`、`services::export_service`
- 测试环境：macOS 24.6.0 arm64，Rust stable，临时目录 + 真实 SQLite（不 mock 数据库），`cargo test --manifest-path src-tauri/Cargo.toml`

## 用例

| 用例 | 输入/前置 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| `db::workspace::tests::migrates_v9_to_v10_and_backfills_attachment_refs` | v9 库含文档/画板/附件，user_version=9 | 升到 v10；文档/画板引用写入 node_attachment；被引用附件 scope=node；type=6 可写入；外键检查 0 | 全部满足 | PASS |
| `db::workspace::tests::migrates_v1_timestamp_columns_and_keeps_data` | v1 旧库含节点 | 升到 v10；时间列改名、旧数据保留、块/元数据/附件表完整 | 全部满足 | PASS |
| `db::workspace::tests::migrates_v6_blob_rows_to_v7_without_losing_objects` | v6 库含 blob 行 | 去掉 ref_count，blob 行与 pack 索引保留 | 全部满足 | PASS |
| `domain::attachment_refs::tests::collects_nested_document_attachment_ids_once` | 嵌套 attachmentImage/attachmentBlock | 去重提取 2 个 id，空 id 忽略 | 2 个 | PASS |
| `domain::attachment_refs::tests::collects_board_image_and_file_card_ids` | image fileId + 文件卡片 objectId | 只收集 2 个有效 id | 2 个 | PASS |
| `integration_tests::document_refs_cascade_and_attachment_trash_restore` | 节点附件被文档引用 | 保存同步引用；被引用禁止删除；删文档标记孤儿；回收站恢复；TTL→回收站→purge | 全部满足 | PASS |
| `integration_tests::attachment_tree_node_rename_delete_and_export` | 上传附件→建 type=6 节点 | 节点/引用建立；重命名同步 attachment.name；导出文件与 manifest attachmentNodes；删节点释放引用并标记孤儿 | 全部满足 | PASS |
| `integration_tests::board_images_use_global_object_ids_and_report_missing_objects` | 画板含 image + 文件卡片 | fileId/objectId 同步引用；清空场景释放引用并标记孤儿 | 全部满足 | PASS |
| `integration_tests::attachment_big_is_deduped_and_refcount_drives_physical_delete` | 同内容大文件上传两次 | 两条逻辑记录共享一份 blob；软删除保留对象；0 保留期维护 purge 后 blob/文件删除 | 全部满足 | PASS |
| `integration_tests::attachment_pack_compaction_keeps_live_objects_readable` | pack 内 8 个小对象，删除 6 个 | 维护 purge 后压缩 pack；存活对象仍可下载/校验 | 全部满足 | PASS |
| `integration_tests::attachment_compaction_removes_pack_without_live_objects` | pack 内对象全部删除 | 维护后空 pack 行/文件删除 | 全部满足 | PASS |

## 执行结果

- `cargo test --manifest-path src-tauri/Cargo.toml`：**77 passed / 0 failed**。
- `cargo clippy --all-targets -- -D warnings`：通过。
- `cargo fmt --check`：通过。

## 说明

- 生产保留期为孤儿 7 天、回收站 30 天；测试通过注入 0 保留期的 `MaintenancePolicy` 覆盖物理清理路径，不靠睡眠等待。
- 旧数据回填只跳过损坏 JSON 并记录日志，不让单条坏数据阻塞整个工作区打开；该行为未在本轮构造坏 JSON 单测，留作后续边界测试。
