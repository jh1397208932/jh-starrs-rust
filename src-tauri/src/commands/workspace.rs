//! 工作区与启动 IPC 适配层：只做参数接收与转发。

use tauri::State;

use crate::errors::AppResult;
use crate::models::{
    BootstrapDto, CreateWorkspaceInput, DeleteWorkspaceInput, DeleteWorkspaceResult,
    RenameWorkspaceInput, WorkspaceDto,
};
use crate::services::workspace_service;
use crate::state::AppState;

/// 启动引导：工作区列表 + 当前工作区 + 全部记忆 + 默认新建目录。
#[tauri::command(async)]
pub fn app_bootstrap(state: State<'_, AppState>) -> AppResult<BootstrapDto> {
    workspace_service::bootstrap(state.inner())
}

/// 查询全部已登记工作区。
#[tauri::command(async)]
pub fn workspace_list(state: State<'_, AppState>) -> AppResult<Vec<WorkspaceDto>> {
    workspace_service::list(state.inner())
}

/// 新建本地工作区并自动切换。
#[tauri::command(async)]
pub fn workspace_create(
    state: State<'_, AppState>,
    input: CreateWorkspaceInput,
) -> AppResult<WorkspaceDto> {
    workspace_service::create(state.inner(), input)
}

/// 打开已有工作区（目录必须含 db/workspace.sqlite3）。
#[tauri::command(async)]
pub fn workspace_open(state: State<'_, AppState>, path: String) -> AppResult<WorkspaceDto> {
    workspace_service::open(state.inner(), &path)
}

/// 统一工作区切换入口。
#[tauri::command(async)]
pub fn workspace_switch(state: State<'_, AppState>, id: String) -> AppResult<WorkspaceDto> {
    workspace_service::switch_workspace(state.inner(), &id)
}

/// 只修改全局注册表中的显示名。
#[tauri::command(async)]
pub fn workspace_rename(
    state: State<'_, AppState>,
    input: RenameWorkspaceInput,
) -> AppResult<WorkspaceDto> {
    workspace_service::rename(state.inner(), input)
}

/// 删除工作区，可选连同本地文件夹删除。
#[tauri::command(async)]
pub fn workspace_delete(
    state: State<'_, AppState>,
    input: DeleteWorkspaceInput,
) -> AppResult<DeleteWorkspaceResult> {
    workspace_service::delete(state.inner(), input)
}
