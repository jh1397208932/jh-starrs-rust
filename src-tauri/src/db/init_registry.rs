//! 统一初始化任务登记表。
//!
//! 约定：库表结构、版本迁移、结构自愈只允许在这里登记；业务代码不写 DDL。
//! 启动时按优先级异步执行；业务路径遇到“需要初始化”的库时，也只调用这里的任务
//! （`ensure_initialized`），不在业务分支里散落建表逻辑。

use rusqlite::Connection;

use crate::errors::AppResult;

/// 全局库结构（工作区注册表与设置）。
pub const P_GLOBAL_SCHEMA: u8 = 10;
/// 工作区版本迁移（按 user_version 前进）。
pub const P_SCHEMA_VERSION: u8 = 20;
/// 工作区结构自愈（版本号可信但结构残缺时补齐）。
pub const P_STRUCTURE_REPAIR: u8 = 30;

/// 一条初始化任务：id 用于日志与测试定位，priority 决定启动时的执行顺序。
pub struct InitTask {
    pub id: &'static str,
    pub priority: u8,
    pub run: fn(&mut Connection) -> AppResult<()>,
}

/// 全局库任务。
pub const GLOBAL_TASKS: &[InitTask] = &[InitTask {
    id: "global-schema",
    priority: P_GLOBAL_SCHEMA,
    run: super::global::task_schema,
}];

/// 工作区任务（顺序：版本迁移 → 结构自愈）。
pub const WORKSPACE_TASKS: &[InitTask] = &[
    InitTask {
        id: "schema-version",
        priority: P_SCHEMA_VERSION,
        run: super::workspace::task_schema_version,
    },
    InitTask {
        id: "structure-repair",
        priority: P_STRUCTURE_REPAIR,
        run: super::workspace::task_structure_repair,
    },
];

/// 按优先级执行任务，返回实际执行的 id 列表（供日志与测试核对）。
pub fn run_tasks(
    connection: &mut Connection,
    tasks: &'static [InitTask],
) -> AppResult<Vec<&'static str>> {
    let mut ordered = tasks.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|task| task.priority);
    let mut executed = Vec::with_capacity(ordered.len());
    for task in ordered {
        (task.run)(connection)?;
        executed.push(task.id);
    }
    Ok(executed)
}
