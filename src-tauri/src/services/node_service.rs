//! 文件树用例：增删改查、层级/路径维护与拖拽移动事务。

use crate::domain::document::to_markdown;
use crate::domain::{NodeType, join_node_path, replace_path_prefix, validate_node_title};
use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::{
    CreateAttachmentNodeInput, CreateNodeInput, DeleteNodeResult, MoveNodeInput, NodeDto, NodeRow,
    RestoreNodeResult, TrashNodeDto, UpdateNodeInput,
};
use crate::repositories::attachment_repository;
use crate::repositories::knowledge_base_repository as kb_repository;
use crate::repositories::node_attachment_repository;
use crate::repositories::node_repository as repository;
use crate::repositories::search_repository;
use crate::services::attachment_reference_service;
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

/// 由已上传对象创建附件叶子节点，并在同一事务登记引用。
///
/// 标题取附件文件名；父级规则与普通节点一致。对象不存在/已删除时拒绝创建。
pub fn create_attachment_node(
    state: &AppState,
    input: CreateAttachmentNodeInput,
) -> AppResult<NodeDto> {
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, &input.knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;
        let attachment = attachment_repository::find_active(connection, &input.object_id)?
            .ok_or_else(|| AppError::not_found("附件不存在或已删除"))?;
        let title = validate_node_title(&attachment.name)?;

        let (parent_id, level, parent_path) = match input.parent_id.as_deref() {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::not_found("父级不存在"))?;
                if parent.knowledge_base_id != input.knowledge_base_id {
                    return Err(AppError::validation("父级不在当前知识库中"));
                }
                if !NodeType::from_i64(parent.node_type)?.is_folder() {
                    return Err(AppError::validation("只能在文件夹中新建"));
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
            node_type: NodeType::Attachment.as_i64(),
            title,
            knowledge_base_id: input.knowledge_base_id,
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
        search_repository::upsert(
            &transaction,
            &row.id,
            &row.title,
            "",
            &row.knowledge_base_id,
            row.node_type,
            now,
        )?;
        let registered = attachment_reference_service::register_node_object(
            &transaction,
            &row.id,
            &input.object_id,
            now,
        )?;
        if !registered {
            return Err(AppError::validation("附件不存在或已删除"));
        }
        transaction.commit()?;
        logging::info(
            "node",
            &format!(
                "创建附件节点 id={} object={} level={} kb={}",
                row.id, input.object_id, row.level, row.knowledge_base_id
            ),
        );
        Ok(row.to_dto())
    })
}

/// 读取单个节点；供导出/导入等需要标题的场景使用。
pub fn get(state: &AppState, id: &str) -> AppResult<NodeDto> {
    with_session(state, |session| {
        let row = repository::find_by_id(&session.connection, id)?
            .ok_or_else(|| AppError::not_found("内容不存在"))?;
        Ok(row.to_dto())
    })
}

/// 新建节点。根节点允许任意类型；有父级时父级必须是同知识库文件夹。
pub fn create(state: &AppState, input: CreateNodeInput) -> AppResult<NodeDto> {
    let node_type = NodeType::from_i64(input.node_type)?;
    if node_type == NodeType::Attachment {
        return Err(AppError::validation("附件请使用上传入口"));
    }
    let title = validate_node_title(&input.title)?;
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, &input.knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;

        let (parent_id, level, parent_path) = match input.parent_id.as_deref() {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::not_found("父级不存在"))?;
                if parent.knowledge_base_id != input.knowledge_base_id {
                    return Err(AppError::validation("父级不在当前知识库中"));
                }
                if !NodeType::from_i64(parent.node_type)?.is_folder() {
                    return Err(AppError::validation("只能在文件夹中新建"));
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
        search_repository::upsert(
            &transaction,
            &row.id,
            &row.title,
            "",
            &row.knowledge_base_id,
            row.node_type,
            now,
        )?;
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
            .ok_or_else(|| AppError::not_found("内容不存在"))?;

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
                        .ok_or_else(|| AppError::not_found("父级不存在"))?
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
                search_repository::update_title(&transaction, &existing.id, final_title, now)?;
                if NodeType::from_i64(existing.node_type)? == NodeType::Attachment
                    && let Some(object_id) =
                        node_attachment_repository::first_object_id(&transaction, &existing.id)?
                {
                    // 节点标题是用户看到的文件名；下载名必须跟随重命名。
                    attachment_repository::update_attachment_meta(
                        &transaction,
                        &object_id,
                        Some(final_title),
                        None,
                        now,
                    )?;
                }
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
            .ok_or_else(|| AppError::not_found("内容不存在"))?;
        Ok(updated.to_dto())
    })
}

/// 将节点（连同全部后代）移入回收站；附件引用与正文保留，恢复后可原样回来。
pub fn delete(state: &AppState, id: &str) -> AppResult<DeleteNodeResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let existing = repository::find_by_id(connection, id)?
            .ok_or_else(|| AppError::not_found("内容不存在"))?;
        let deleted_count = repository::count_subtree(connection, &existing.id)?;
        let now = now_ms();
        let transaction = connection.unchecked_transaction()?;
        search_repository::delete_subtree(&transaction, &existing.id)?;
        repository::soft_delete_subtree(&transaction, &existing.id, now)?;
        transaction.commit()?;
        logging::info(
            "node",
            &format!("移入回收站 id={} 含后代={deleted_count}", existing.id),
        );
        Ok(DeleteNodeResult { deleted_count })
    })
}

/// 列出知识库回收站根节点。
pub fn trash_list(state: &AppState, knowledge_base_id: &str) -> AppResult<Vec<TrashNodeDto>> {
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;
        let rows = repository::list_trash_roots(connection, knowledge_base_id)?;
        Ok(rows
            .into_iter()
            .map(|row| TrashNodeDto {
                id: row.id,
                knowledge_base_id: row.knowledge_base_id,
                parent_id: row.parent_id,
                node_type: row.node_type,
                title: row.title,
                path: row.path,
                deleted_at: row.deleted_at,
            })
            .collect())
    })
}

/// 从回收站恢复整棵子树，并按当前父级重算层级/路径与搜索索引。
pub fn restore(state: &AppState, id: &str) -> AppResult<RestoreNodeResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let trash = repository::find_trash(connection, id)?
            .ok_or_else(|| AppError::not_found("回收站中不存在此内容"))?;
        let parent = match trash.parent_id.as_deref() {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::validation("上级内容还在回收站，请先恢复上级"))?;
                Some(parent)
            }
            None => None,
        };
        let old_rows = repository::subtree_any(connection, id)?;
        let root_old_level = old_rows
            .iter()
            .find(|row| row.id == id)
            .map_or(1, |row| row.level);
        let old_root_path = old_rows
            .iter()
            .find(|row| row.id == id)
            .map_or_else(|| trash.path.clone(), |row| row.path.clone());
        let new_level = parent.as_ref().map_or(1, |row| row.level + 1);
        let new_path = join_node_path(parent.as_ref().map(|row| row.path.as_str()), &trash.title);
        let level_delta = new_level - root_old_level;
        let now = now_ms();

        let transaction = connection.unchecked_transaction()?;
        let restored = repository::restore_subtree(&transaction, id)?;
        repository::update_subtree_position(&transaction, id, new_level, &new_path, now)?;
        for row in old_rows.iter().filter(|row| row.id != id) {
            let path = replace_path_prefix(&row.path, &old_root_path, &new_path);
            repository::update_subtree_position(
                &transaction,
                &row.id,
                row.level + level_delta,
                &path,
                now,
            )?;
        }
        for seed in repository::subtree_search_rows(&transaction, id)? {
            let body = if seed.node_type == 2 {
                serde_json::from_str::<serde_json::Value>(&seed.content)
                    .map(|value| to_markdown(&value))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            search_repository::upsert(
                &transaction,
                &seed.id,
                &seed.title,
                &body,
                &seed.knowledge_base_id,
                seed.node_type,
                now,
            )?;
        }
        transaction.commit()?;
        logging::info("node", &format!("从回收站恢复 id={id} 含后代={restored}"));
        Ok(RestoreNodeResult {
            restored_count: restored as i64,
        })
    })
}

fn purge_rows(
    transaction: &rusqlite::Transaction<'_>,
    roots: &[repository::TrashRow],
) -> AppResult<i64> {
    let mut object_ids = std::collections::BTreeSet::new();
    let mut total = 0_i64;
    for root in roots {
        object_ids.extend(node_attachment_repository::object_ids_for_subtree(
            transaction,
            &root.id,
        )?);
        total += repository::subtree_any(transaction, &root.id)?.len() as i64;
        search_repository::delete_subtree(transaction, &root.id)?;
        repository::delete(transaction, &root.id)?;
    }
    attachment_reference_service::mark_orphans_for(transaction, &object_ids, now_ms())?;
    Ok(total)
}

/// 永久删除单个回收站根节点及其后代。
pub fn trash_purge(state: &AppState, id: &str) -> AppResult<DeleteNodeResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        let trash = repository::find_trash(connection, id)?
            .ok_or_else(|| AppError::not_found("回收站中不存在此内容"))?;
        let transaction = connection.unchecked_transaction()?;
        let deleted_count = purge_rows(&transaction, &[trash])?;
        transaction.commit()?;
        logging::info("node", &format!("永久删除 id={id} 含后代={deleted_count}"));
        Ok(DeleteNodeResult { deleted_count })
    })
}

/// 清空某知识库的回收站。
pub fn trash_empty(state: &AppState, knowledge_base_id: &str) -> AppResult<DeleteNodeResult> {
    with_session(state, |session| {
        let connection = &session.connection;
        kb_repository::find_by_id(connection, knowledge_base_id)?
            .ok_or_else(|| AppError::not_found("知识库不存在"))?;
        let roots = repository::list_trash_roots(connection, knowledge_base_id)?;
        if roots.is_empty() {
            return Ok(DeleteNodeResult { deleted_count: 0 });
        }
        let transaction = connection.unchecked_transaction()?;
        let deleted_count = purge_rows(&transaction, &roots)?;
        transaction.commit()?;
        logging::info(
            "node",
            &format!("清空回收站 kb={knowledge_base_id} 含后代={deleted_count}"),
        );
        Ok(DeleteNodeResult { deleted_count })
    })
}

/// 启动时清理超过保留期的回收站内容；保留天数复用附件回收站设置。
pub fn purge_expired_trash(state: &AppState, retention_days: i64) -> AppResult<i64> {
    with_session(state, |session| {
        let connection = &session.connection;
        let cutoff = now_ms().saturating_sub(retention_days.max(1) * 24 * 60 * 60 * 1000);
        let roots = repository::list_expired_trash_roots(connection, cutoff)?;
        if roots.is_empty() {
            return Ok(0);
        }
        let transaction = connection.unchecked_transaction()?;
        let deleted_count = purge_rows(&transaction, &roots)?;
        transaction.commit()?;
        logging::info(
            "node",
            &format!("清理过期回收站 含后代={deleted_count} cutoff={cutoff}"),
        );
        Ok(deleted_count)
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
            .ok_or_else(|| AppError::not_found("内容不存在"))?;
        let target_parent_id = input.parent_id.as_deref();

        if target_parent_id == Some(node.id.as_str()) {
            return Err(AppError::validation("不能移动到自身之下"));
        }

        let (new_level, parent_path) = match target_parent_id {
            Some(parent_id) => {
                let parent = repository::find_by_id(connection, parent_id)?
                    .ok_or_else(|| AppError::not_found("目标文件夹不存在"))?;
                if parent.knowledge_base_id != node.knowledge_base_id {
                    return Err(AppError::validation("不能跨知识库移动"));
                }
                if !NodeType::from_i64(parent.node_type)?.is_folder() {
                    return Err(AppError::validation("只能移动到文件夹中"));
                }
                if repository::is_ancestor(connection, parent_id, &node.id)? {
                    return Err(AppError::validation("不能移动到自己的子级"));
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
