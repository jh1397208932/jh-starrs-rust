//! AI 协作命令：权限配置、待审区与审计。

use serde_json::Value;

use crate::errors::AppResult;
use crate::repositories::ai_repository::{AiAuditRow, AiInboxRow, AiPermissions};
use crate::services::ai_service;
use crate::state::AppState;

/// 读取权限配置。
#[tauri::command]
pub fn ai_permissions_get(state: tauri::State<'_, AppState>) -> AppResult<AiPermissions> {
    ai_service::permissions(&state)
}

/// 写入权限配置。
#[tauri::command]
pub fn ai_permissions_set(
    state: tauri::State<'_, AppState>,
    permissions: AiPermissions,
) -> AppResult<AiPermissions> {
    ai_service::set_permissions(&state, permissions)
}

/// 待审列表。
#[tauri::command]
pub fn ai_inbox_list(
    state: tauri::State<'_, AppState>,
    status: Option<String>,
) -> AppResult<Vec<AiInboxRow>> {
    ai_service::inbox(&state, status.as_deref())
}

/// 审批通过并执行写入。
#[tauri::command]
pub fn ai_inbox_approve(state: tauri::State<'_, AppState>, id: String) -> AppResult<Value> {
    ai_service::approve(&state, &id)
}

/// 拒绝待审项。
#[tauri::command]
pub fn ai_inbox_reject(state: tauri::State<'_, AppState>, id: String) -> AppResult<()> {
    ai_service::reject(&state, &id)
}

/// 审计列表。
#[tauri::command]
pub fn ai_audit_list(state: tauri::State<'_, AppState>) -> AppResult<Vec<AiAuditRow>> {
    ai_service::audit(&state)
}
