//! 画板持久化 IPC 适配层。

use tauri::State;

use crate::errors::AppResult;
use crate::models::board::{
    BoardLoadResult, BoardSaveInput, BoardSaveResult, BoardSaveViewportInput, BoardViewportDto,
};
use crate::services::board_service;
use crate::state::AppState;

/// 加载画板场景、视口与图片对象。
#[tauri::command(async)]
pub fn board_load(state: State<'_, AppState>, node_id: String) -> AppResult<BoardLoadResult> {
    board_service::load(state.inner(), &node_id)
}

/// 保存画板场景（不包含文件字节）。
#[tauri::command(async)]
pub fn board_save(state: State<'_, AppState>, input: BoardSaveInput) -> AppResult<BoardSaveResult> {
    board_service::save(state.inner(), input)
}

/// 只保存画板视口。
#[tauri::command(async)]
pub fn board_save_viewport(
    state: State<'_, AppState>,
    input: BoardSaveViewportInput,
) -> AppResult<BoardViewportDto> {
    board_service::save_viewport(state.inner(), input)
}
