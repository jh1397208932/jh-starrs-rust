//! 统一初始化任务登记表。
//!
//! 约定：库表结构初始化只允许在这里登记；业务代码不写 DDL。
//! 不登记任何版本迁移或结构自愈任务（AGENTS.md §9 无历史数据原则）；
//! 工作区库由 `workspace::ensure_initialized` 在打开会话时按当前 schema 初始化。

use rusqlite::Connection;

use crate::errors::AppResult;

/// 全局库结构（工作区注册表与设置）。
pub const P_GLOBAL_SCHEMA: u8 = 10;
/// 一条初始化任务：id 用于日志与测试定位，priority 决定启动时的执行顺序。
pub struct InitTask {
    pub id: &'static str,
    pub priority: u8,
    pub run: fn(&mut Connection) -> AppResult<()>,
}

/// 全局库任务。
pub const GLOBAL_TASKS: &[InitTask] = &[InitTask {
    id: "global-init",
    priority: P_GLOBAL_SCHEMA,
    run: super::global::task_init,
}];

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
