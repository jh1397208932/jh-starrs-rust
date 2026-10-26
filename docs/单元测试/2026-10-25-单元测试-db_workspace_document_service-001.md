# 单元测试 · 数据安全与入口诚实化

- 日期：2026-10-25
- 关联任务：`docs/开发任务清单/2026-10-25-任务-007/`
- 关联需求：`docs/需求文档/2026-10-25-需求文档-数据安全与入口诚实化.md`
- 被测模块：`db::workspace`、`services::document_service`、`services::attachment_maintenance_service`
- 测试环境：Rust 单元/集成测试，临时目录 + 真实 SQLite；`cargo test --manifest-path src-tauri/Cargo.toml`
- 代码版本：2026-10-25 本地工作区（schema v11）

| 用例 | 输入/前置 | 期望 | 实际 | 结果 |
|---|---|---|---|---|
| `migration_backup_is_created_once_and_remains_readable` | v9 工作区、`user_version=9` | 升级到 v11；`db/backups/` 生成 1 份可打开备份；再次打开不重复备份 | 符合 | 通过 |
| `migration_backup_failure_aborts_upgrade` | v9 库；`db/backups` 被普通文件占用 | `open` 返回错误；原库保持 `user_version=9` | 符合 | 通过 |
| `prune_backups_keeps_latest_three` | 5 个伪造备份文件 | 只保留 3 个 | 符合 | 通过 |
| `migrates_v9_to_v10_and_backfills_attachment_refs` | v9 库含文档/画板附件引用 | 升到 v11；`doc_version=0`；引用回填；附件节点可写入；外键无悬空 | 符合 | 通过 |
| `document_save_rejects_stale_version` | 文档保存一次后，用 `base_version=0` 再次保存 | 第二次返回 `AppError::Conflict`；数据库保留第一版；用新版本可保存为 v2 | 符合 | 通过 |
| `maintenance_delete_serializes_with_same_hash_upload` | 300 KiB 同哈希文件；上传线程 + 维护线程各 24 轮 | 每轮上传完成的对象 `verify.valid=true`；维护无错误；无悬空对象 | 符合 | 通过 |

## 汇总

- Rust 全量：**82 passed / 0 failed**（含既有工作区、文档、画板、附件、导入导出测试）。
- 前端：Biome 146 文件通过；`tsc --noEmit` 通过；`npm run build` 与许可证门禁通过。
- 真机 E2E：17/17 通过；关闭保存、文档冲突、入口收敛均有自动化用例。
- 未执行：无（本轮相关单元/集成测试均已执行）。
- 已知限制：`doc_version` 只做文档正文并发控制，不提供历史版本；迁移备份保留 3 份，空间不足时不会自动扩容。
