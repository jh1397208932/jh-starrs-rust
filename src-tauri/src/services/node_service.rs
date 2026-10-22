//! 文件树用例：增删改查、层级/路径维护与拖拽移动事务。

use crate::domain::{NodeType, join_node_path, replace_path_prefix, validate_node_title};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::{
    CreateNodeInput, DeleteNodeResult, MoveNodeInput, NodeDto, NodeRow, UpdateNodeInput,
};
use crate::repositories::knowledge_base_repository as kb_repository;
use crate::repositories::node_repository as repository;
use crate::state::{AppState, WorkspaceSession};
use crate::utils::{new_id, now_ms};

/// 读取指定知识库的完整平表树。
pub fn list(state: &AppState, knowledge_base_id: &str) -> AppResult<Vec<NodeDto>> {
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;
        let rows = repository::list_by_kb(connection, knowledge_base_id)?;
        Ok(rows.into_iter().map(|row| row.to_dto()).collect())
    })
}

/// 新建节点。根节点允许任意类型；有父级时父级必须是同知识库文件夹。
pub fn create(state: &AppState, input: CreateNodeInput) -> AppResult<NodeDto> {
    let node_type = NodeType::from_i64(input.node_type)?;
    let title = validate_node_title(&input.title)?;
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, &input.knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;

        let (parent_id, level, parent_path) = match input.parent_id.as_deref() {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::not_found("父节点不存在"))?;
                if parent.knowledge_base_id != input.knowledge_base_id {
                    return Err(AppError::validation("父节点不在当前知识库中"));
                }
                if !NodeType::from_i64(parent.node_type)?.is_folder() {
                    return Err(AppError::validation("只有文件夹可以创建子节点"));
                }
                (
                    Some(parent_id.to_string()),
                    parent.level + 1,
                    Some(parent.path),
                )
            }
            None => (None, 1, None),
        };

        let path = join_node_path(parent_path.as_deref(), &title);
        let sort_order =
            repository::max_sort_order(connection, &input.knowledge_base_id, parent_id.as_deref())?
                .map_or(0, |value| value + 1);
        let now = now_ms();
        let row = NodeRow {
            id: new_id(),
            node_type: node_type.as_i64(),
            title,
            knowledge_base_id: input.knowledge_base_id.clone(),
            parent_id,
            level,
            path,
            sort_order,
            starred: false,
            word_count: 0,
            create_time: now,
            update_time: now,
        };

        let transaction = connection.unchecked_transaction()?;
        repository::insert(&transaction, &row)?;
        transaction.commit()?;
        logging::info(
            "node",
            &format!(
                "创建节点 id={} type={} level={} kb={}",
                row.id, row.node_type, row.level, row.knowledge_base_id
            ),
        );
        Ok(row.to_dto())
    })
}

/// 修改节点标题/收藏状态；文件夹改名同步所有后代 path。
pub fn update(state: &AppState, input: UpdateNodeInput) -> AppResult<NodeDto> {
    with_session(state, |session| {
        let connection = &session.connection;
        let existing = repository::find_by_id(connection, &input.id)?
            .ok_or_else(|| AppError::not_found("节点不存在"))?;

        let new_title = match input.title {
            Some(raw) => Some(validate_node_title(&raw)?),
            None => None,
        };
        let title_changed = new_title
            .as_deref()
            .is_some_and(|title| title != existing.title);
        let star_changed = input
            .starred
            .is_some_and(|starred| starred != existing.starred);

        if title_changed || star_changed {
            let parent_path = match existing.parent_id.as_deref() {
                Some(parent_id) => Some(
                    repository::find_by_id(connection, parent_id)?
                        .ok_or_else(|| AppError::not_found("父节点不存在"))?
                        .path,
                ),
                None => None,
            };
            let final_title = new_title.as_deref().unwrap_or(&existing.title);
            let new_path = join_node_path(parent_path.as_deref(), final_title);
            let descendants =
                if title_changed && NodeType::from_i64(existing.node_type)?.is_folder() {
                    repository::subtree(connection, &existing.id)?
                } else {
                    Vec::new()
                };
            let now = now_ms();
            let transaction = connection.unchecked_transaction()?;
            if title_changed {
                repository::update_title(&transaction, &existing.id, final_title, &new_path, now)?;
                for descendant in descendants.iter().filter(|row| row.id != existing.id) {
                    let path = replace_path_prefix(&descendant.path, &existing.path, &new_path);
                    repository::update_subtree_position(
                        &transaction,
                        &descendant.id,
                        descendant.level,
                        &path,
                        now,
                    )?;
                }
                logging::info("node", &format!("重命名节点 id={}", existing.id));
            }
            if let Some(starred) = input.starred
                && star_changed
            {
                repository::update_starred(&transaction, &existing.id, starred, now)?;
            }
            transaction.commit()?;
        }

        let updated = repository::find_by_id(connection, &existing.id)?
            .ok_or_else(|| AppError::not_found("节点不存在"))?;
        Ok(updated.to_dto())
    })
}

/// 递归删除节点（文件夹连同全部后代）。
pub fn delete(state: &AppState, id: &str) -> AppResult<DeleteNodeResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let existing = repository::find_by_id(connection, id)?
            .ok_or_else(|| AppError::not_found("节点不存在"))?;
        let deleted_count = repository::count_subtree(connection, &existing.id)?;
        let transaction = connection.unchecked_transaction()?;
        repository::delete(&transaction, &existing.id)?;
        transaction.commit()?;
        logging::info(
            "node",
            &format!("删除节点 id={} 含后代={deleted_count}", existing.id),
        );
        Ok(DeleteNodeResult { deleted_count })
    })
}

/// 拖动移动：成为目标父级子节点，并插入到同级 `index` 位置。
///
/// 规则：父级必须同知识库文件夹；不能移入自身后代；移动后重算子树 level/path，
/// 并重排目标组与（父级变化时的）原同级组。
pub fn move_node(state: &AppState, input: MoveNodeInput) -> AppResult<Vec<NodeDto>> {
    with_session(state, |session| {
        let connection = &session.connection;
        let node = repository::find_by_id(connection, &input.id)?
            .ok_or_else(|| AppError::not_found("节点不存在"))?;
        let target_parent_id = input.parent_id.as_deref();

        if target_parent_id == Some(node.id.as_str()) {
            return Err(AppError::validation("不能把节点移动到自身之下"));
        }

        let (new_level, parent_path) = match target_parent_id {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::not_found("目标文件夹不存在"))?;
                if parent.knowledge_base_id != node.knowledge_base_id {
                    return Err(AppError::validation("不能跨知识库移动节点"));
                }
                if !NodeType::from_i64(parent.node_type)?.is_folder() {
                    return Err(AppError::validation("只能移动到文件夹中"));
                }
                if repository::is_ancestor(connection, parent_id, &node.id)? {
                    return Err(AppError::validation("不能把文件夹移动到自己的子级中"));
                }
                (parent.level + 1, Some(parent.path))
            }
            None => (1, None),
        };

        let new_path = join_node_path(parent_path.as_deref(), &node.title);
        let old_parent_id = node.parent_id.clone();
        let subtree = repository::subtree(connection, &node.id)?;
        let level_delta = new_level - node.level;

        let mut target_siblings =
            repository::sibling_ids(connection, &node.knowledge_base_id, target_parent_id)?;
        target_siblings.retain(|id| id != &node.id);
        let index = input.index.clamp(0, target_siblings.len() as i64) as usize;
        target_siblings.insert(index, node.id.clone());

        let now = now_ms();
        let transaction = connection.unchecked_transaction()?;
        repository::update_move(
            &transaction,
            &node.id,
            target_parent_id,
            new_level,
            &new_path,
            now,
        )?;
        for descendant in subtree.iter().filter(|row| row.id != node.id) {
            let path = replace_path_prefix(&descendant.path, &node.path, &new_path);
            repository::update_subtree_position(
                &transaction,
                &descendant.id,
                descendant.level + level_delta,
                &path,
                now,
            )?;
        }
        for (position, id) in target_siblings.iter().enumerate() {
            repository::update_sort_order(&transaction, id, position as i64)?;
        }
        if old_parent_id.as_deref() != target_parent_id {
            let old_siblings = repository::sibling_ids(
                &transaction,
                &node.knowledge_base_id,
                old_parent_id.as_deref(),
            )?;
            for (position, id) in old_siblings.iter().enumerate() {
                repository::update_sort_order(&transaction, id, position as i64)?;
            }
        }
        transaction.commit()?;
        logging::info(
            "node",
            &format!(
                "移动节点 id={} target_parent={:?} index={}",
                node.id, target_parent_id, index
            ),
        );

        let rows = repository::list_by_kb(connection, &node.knowledge_base_id)?;
        Ok(rows.into_iter().map(|row| row.to_dto()).collect())
    })
}

/// 在当前工作区会话内执行闭包；无工作区时统一报错。
fn with_session<T>(
    state: &AppState,
    action: impl FnOnce(&WorkspaceSession) -> AppResult<T>,
) -> AppResult<T> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    action(session)
}
