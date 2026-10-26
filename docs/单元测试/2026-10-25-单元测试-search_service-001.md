# 单元测试 · 检索与存储闭环

- 日期：2026-10-25
- 关联任务：`docs/开发任务清单/2026-10-25-任务-008/`
- 被测模块：`db::workspace`、`services::search_service`、`services::attachment_maintenance_service`
- 环境：临时目录 + 真实 SQLite；`cargo test --manifest-path src-tauri/Cargo.toml`

| 用例 | 期望 | 结果 |
|---|---|---|
| `bundled_sqlite_supports_fts5_trigram` | FTS5 trigram 可用，3 字子串命中 | 通过 |
| `search_indexes_titles_and_documents_and_removes_stale_rows` | 3 字 FTS、2 字 LIKE、正文片段、改名/删除无陈旧结果 | 通过 |
| `migrates_v9_to_v10_and_backfills_attachment_refs` | v9→v12；`search_index` 回填 2 行；FTS 可检索 | 通过 |
| `maintenance_removes_unreferenced_doc_hashes` | 删除文档后 GC 移除 1 个无引用 hash | 通过 |
| `maintenance_quarantines_untracked_objects_and_prunes_old_quarantine` | 24h 前无 DB 行文件移入 quarantine；新文件/已知 pack 保留；旧隔离目录清理 | 通过 |
| `search_service::like_pattern_escapes_wildcards` | `%`/`_`/`\` 转义 | 通过 |
| `search_service::snippet_centers_query_and_elides` | 片段居中并带省略号 | 通过 |

- 全量 Rust：**88 passed / 0 failed**。
- 真机 E2E：18/18 通过。
