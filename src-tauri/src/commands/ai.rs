//! AI 协作命令：权限配置、待审区、审计与待审对比。
//!
//! 全部走后台线程：审批会整篇加载并重写文档，留在主线程会卡住窗口。

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::repositories::ai_repository::{AiAuditRow, AiInboxRow, AiPermissions};
use crate::services::{ai_review, ai_service};
use crate::state::AppState;

/// 把一次 AI 协作调用挪出主线程；闭包内按 AppHandle 重新取状态。
async fn offload<T: Send + 'static>(
    app: AppHandle,
    job: impl FnOnce(&AppState) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    match tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        job(state.inner())
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            logging::error("ai", &format!("AI 后台任务异常: {error}"));
            Err(AppError::Internal)
        }
    }
}

/// 读取权限配置。
#[tauri::command(async)]
pub async fn ai_permissions_get(app: AppHandle) -> AppResult<AiPermissions> {
    offload(app, ai_service::permissions).await
}

/// 写入权限配置。
#[tauri::command(async)]
pub async fn ai_permissions_set(
    app: AppHandle,
    permissions: AiPermissions,
) -> AppResult<AiPermissions> {
    offload(app, move |state| {
        ai_service::set_permissions(state, permissions)
    })
    .await
}

/// 待审列表。
#[tauri::command(async)]
pub async fn ai_inbox_list(app: AppHandle, status: Option<String>) -> AppResult<Vec<AiInboxRow>> {
    offload(app, move |state| {
        ai_service::inbox(state, status.as_deref())
    })
    .await
}

/// 审批通过并执行写入。
#[tauri::command(async)]
pub async fn ai_inbox_approve(app: AppHandle, id: String) -> AppResult<Value> {
    offload(app, move |state| ai_service::approve(state, &id)).await
}

/// 拒绝待审项。
#[tauri::command(async)]
pub async fn ai_inbox_reject(app: AppHandle, id: String) -> AppResult<()> {
    offload(app, move |state| ai_service::reject(state, &id)).await
}

/// 重新取一条待审项的前后对比，供主界面确认窗再次打开。
#[tauri::command(async)]
pub async fn ai_review_preview(
    app: AppHandle,
    id: String,
) -> AppResult<ai_review::AiReviewPreview> {
    offload(app, move |state| ai_review::preview_inbox(state, &id)).await
}

/// 审计列表。
#[tauri::command(async)]
pub async fn ai_audit_list(app: AppHandle) -> AppResult<Vec<AiAuditRow>> {
    offload(app, ai_service::audit).await
}
