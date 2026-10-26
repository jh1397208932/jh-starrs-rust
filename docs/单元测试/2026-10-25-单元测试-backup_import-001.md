# 单元测试 · 备份/恢复与附件导入

- 日期：2026-10-25
- 关联任务：`docs/开发任务清单/2026-10-25-任务-008/`
- 被测模块：`services::backup_service`、`services::import_service`、`repositories::attachment_repository`

| 用例 | 期望 | 结果 |
|---|---|---|
| `workspace_backup_and_restore_roundtrip` | 备份含 `backup.json`/DB；恢复后文档与附件可读；非空目标拒绝 | 通过 |
| `attachment_tree_node_rename_delete_and_export`（扩展） | 导出 manifest → 重新导入 → type=6 节点与对象恢复、校验通过 | 通过 |
| 附件列表分页/搜索 | 服务层 limit/offset/search 生效；UI 加载更多（E2E 附件管理覆盖） | 通过 |

- 全量 Rust：89 passed / 0 failed。
- E2E：19/19。
- 已知限制：恢复 UI 未做独立真机用例；备份为整目录副本，不压缩。
