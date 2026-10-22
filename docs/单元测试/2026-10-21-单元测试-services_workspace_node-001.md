# 单元/集成测试报告 · 工作区与文件树服务

- 日期：2026-10-21
- 关联需求：`docs/需求文档/2026-10-21-需求文档-本地工作区与文件树.md`
- 关联任务：`docs/开发任务清单/2026-10-21-任务-005/`
- 代码版本：`ab47339` + 本任务未提交工作区（2026-10-21）
- 测试环境：macOS 24.6（arm64）、Rust 1.99.0、rusqlite 0.40.2（bundled SQLite）、tempfile 3.27.0
- 被测模块：
  - `src-tauri/src/services/workspace_service.rs`
  - `src-tauri/src/services/knowledge_base_service.rs`
  - `src-tauri/src/services/node_service.rs`
  - `src-tauri/src/services/memory_service.rs`
  - `src-tauri/src/domain/mod.rs`
- 测试入口：`src-tauri/src/integration_tests.rs`（真实临时目录 + 真实 SQLite，不使用 mock 数据库）

## 执行命令

```bash
cd src-tauri
cargo test
```

实际结果：

```text
running 12 tests
test domain::tests::node_type_rejects_out_of_range ... ok
test domain::tests::replace_prefix_only_matches_segments ... ok
test domain::tests::title_rejects_path_separators ... ok
test state::assert_state_is_send_sync ... ok
test db::workspace::tests::migrates_v1_timestamp_columns_and_keeps_data ... ok
test integration_tests::memory_config_validates_keys_and_theme_values ... ok
test integration_tests::open_requires_valid_structure_and_adopts_existing_workspace ... ok
test integration_tests::knowledge_base_crud_and_cascade_delete ... ok
test integration_tests::node_move_supports_reorder_and_reparent_with_guards ... ok
test integration_tests::node_tree_levels_paths_and_folder_rename ... ok
test integration_tests::restart_restores_remembered_workspace_and_theme ... ok
test integration_tests::workspace_lifecycle_uses_single_switch_entry ... ok

test result: ok. 12 passed; 0 failed
```

## 用例明细

| 编号 | 用例 | 前置/输入 | 期望 | 实际 | 结论 |
|---|---|---|---|---|---|
| U01 | 工作区生命周期与统一切换 | 创建两个工作区 | 目录/db/storage 存在；默认知识库；仅一个 current；切换写记忆；改名不改目录 | 全部满足；UUID 可解析且 version=7 | 通过 |
| U02 | 删除当前工作区 | 当前为第二个工作区，`delete_folder=true` | 返回最近的其他工作区为 next；目录被删除；记忆指向 next | 满足 | 通过 |
| U03 | 删除最后一个工作区 | `delete_folder=false` | 当前会话清空；记忆移除；注册表空；目录保留；引导无当前 | 满足 | 通过 |
| U04 | 打开工作区校验 | 普通空目录 | 返回 `InvalidWorkspace` | 满足 | 通过 |
| U05 | 重新打开/接管目录 | 已有工作区目录；或删注册保目录后再打开 | 同路径不重复登记；接管生成新 UUID v7 | 满足 | 通过 |
| U06 | 重启恢复 | 保存主题记忆后重开全局库 | 恢复上次工作区；主题/明暗键保留 | 满足 | 通过 |
| U07 | 知识库 CRUD 与级联 | 新建/改名/改描述/删除；库内 2 节点 | docCount 只统计非文件夹；删除级联节点；删除后查询 NotFound；空名拒绝 | 满足 | 通过 |
| U08 | 树层级与 folder 改名 | 设计/原型/首页 + 根级情绪板 | level/path/sort 正确；非文件夹不可建子级；非法标题拒绝；folder 改名同步后代 path；递归删除 3 个 | 满足 | 通过 |
| U09 | 移动排序与约束 | 父级/根级互换、索引插入 | level/path 更新；同级序号连续；移入自身后代拒绝；非文件夹作父级拒绝；跨知识库拒绝 | 满足 | 通过 |
| U10 | 记忆校验 | 合法主题/模式/自定义键/`kb.current.ws-1`；非法主题/保留键/非法键名 | 合法写入并可读；非法返回 Validation | 满足 | 通过 |
| U11 | AppState 线程约束 | 编译期断言 | `AppState: Send + Sync` | 满足 | 通过 |
| U12 | 工作区库 v1→v2 迁移 | 旧库 node 含 `created_at/updated_at` 与一条数据 | 列重命名为 `create_time/update_time`；版本=2；旧数据保留 | 满足 | 通过 |

领域纯函数：

| 编号 | 用例 | 期望 | 结论 |
|---|---|---|---|
| D01 | NodeType 1~5 | 1/5 通过，0/6 拒绝 | 通过 |
| D02 | 标题路径校验 | `/`、`\` 拒绝；首尾空格 trim | 通过 |
| D03 | 路径前缀替换 | 只替换完整路径段（`a/bc` 不受 `a/b` 影响） | 通过 |

## 未覆盖与风险

- 未直接单测 `db::paths::verify_workspace_deletable` 的符号链接/主目录分支；工作区删除的正常路径已由 U02 覆盖。建议后续补一个符号链接用例。
- 未做多进程并发写同一个工作区库的测试；当前仅依赖 SQLite WAL + busy_timeout。
- 未做 Tauri 命令层（IPC 参数序列化/权限）的自动化测试；由前端构建与功能测试补充，真实窗口交互本轮受锁屏阻塞。
