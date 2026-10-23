//! 服务层集成测试：真实临时 SQLite + 真实工作区目录，不 mock 数据库。
//!
//! 覆盖工作区生命周期、统一切换入口、知识库级联、文件树层级/path/排序与拖拽约束、
//! 记忆配置与“重启后恢复”。测试通过后仍需在真实 Tauri 应用做黑盒冒烟。

use std::collections::BTreeMap;
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tempfile::TempDir;
use uuid::Uuid;

use crate::db;
use crate::domain::attachment::StoragePolicy;
use crate::errors::AppError;
use crate::models::attachment::{
    AttachmentDto, AttachmentListQuery, DownloadAttachmentInput, UpdateAttachmentInput,
    UploadAttachmentInput,
};
use crate::models::{
    CreateKbInput, CreateNodeInput, CreateWorkspaceInput, DeleteWorkspaceInput, DocSaveResult,
    MoveNodeInput, NodeDto, RenameWorkspaceInput, SaveDocumentInput, UpdateKbInput,
    UpdateNodeInput, WorkspaceDto,
};
use crate::repositories::attachment_repository;
use crate::repositories::document_repository;
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::{
    attachment_store, document_service, knowledge_base_service, memory_service, node_service,
    workspace_service,
};
use crate::state::AppState;

const FOLDER: i64 = 1;
const DOC: i64 = 2;
const BOARD: i64 = 3;

/// 测试环境：临时目录 + 已打开全局库的 AppState。
struct TestEnv {
    dir: TempDir,
    global_db: PathBuf,
    state: AppState,
}

impl TestEnv {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("创建临时目录");
        let global_db = dir.path().join("db/starris.db");
        let connection = db::global::open(&global_db).expect("打开全局库");
        Self {
            dir,
            global_db,
            state: AppState::new(connection, None),
        }
    }

    fn workspace_path(&self, folder: &str) -> String {
        self.dir.path().join(folder).to_string_lossy().into_owned()
    }

    fn create_workspace(&self, folder: &str, name: &str) -> WorkspaceDto {
        workspace_service::create(
            &self.state,
            CreateWorkspaceInput {
                name: name.to_string(),
                path: self.workspace_path(folder),
                avatar_color: String::new(),
            },
        )
        .expect("创建工作区")
    }

    fn first_kb_id(&self) -> String {
        knowledge_base_service::list(&self.state)
            .expect("知识库列表")
            .first()
            .expect("默认知识库存在")
            .id
            .clone()
    }

    fn create_node(
        &self,
        kb_id: &str,
        parent_id: Option<&str>,
        node_type: i64,
        title: &str,
    ) -> NodeDto {
        node_service::create(
            &self.state,
            CreateNodeInput {
                knowledge_base_id: kb_id.to_string(),
                parent_id: parent_id.map(str::to_string),
                node_type,
                title: title.to_string(),
            },
        )
        .expect("创建节点")
    }

    fn save_doc(&self, node_id: &str, document: Value) -> DocSaveResult {
        document_service::save(
            &self.state,
            SaveDocumentInput {
                node_id: node_id.to_string(),
                document,
            },
        )
        .expect("保存文档")
    }
}

fn paragraph(text: &str) -> Value {
    json!({"type": "paragraph", "content": [{"type": "text", "text": text}]})
}

fn document(blocks: Vec<Value>) -> Value {
    json!({"type": "doc", "content": blocks})
}

fn orders(result: &DocSaveResult) -> Vec<&str> {
    result.tree.iter().map(|node| node.order.as_str()).collect()
}

fn assert_tree_ordered(result: &DocSaveResult) {
    let values = orders(result);
    for pair in values.windows(2) {
        assert!(pair[0] < pair[1], "{} < {}", pair[0], pair[1]);
    }
    assert!(values.iter().all(|value| value.len() <= 32));
    for node in &result.tree {
        assert_uuid_v7(&node.id);
        assert_eq!(node.hash.len(), 32);
    }
}

fn assert_uuid_v7(id: &str) {
    let uuid = Uuid::parse_str(id).expect("UUID 可解析");
    assert_eq!(uuid.get_version_num(), 7, "主键必须是 UUID v7: {id}");
}

/// 等待异步元数据落库；返回 (markdown, prop)。
fn wait_for_meta(db_path: &Path, node_id: &str) -> (String, String) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if let Ok(connection) = db::workspace::open_existing(db_path)
            && let Ok(Some((markdown, prop, _))) =
                document_repository::find_meta(&connection, node_id)
        {
            return (markdown, prop);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    panic!("异步元数据未在 3s 内写入 node={node_id}");
}

fn find_node<'a>(nodes: &'a [NodeDto], id: &str) -> &'a NodeDto {
    nodes.iter().find(|node| node.id == id).expect("节点存在")
}

#[test]
fn workspace_lifecycle_uses_single_switch_entry() {
    let env = TestEnv::new();
    let first = env.create_workspace("ws-first", "星屿工作区");
    assert!(first.is_current);
    assert_uuid_v7(&first.id);
    assert!(
        PathBuf::from(&first.path)
            .join("db/workspace.sqlite3")
            .is_file()
    );
    assert!(PathBuf::from(&first.path).join("storage").is_dir());

    let kbs = knowledge_base_service::list(&env.state).expect("默认知识库");
    assert_eq!(kbs.len(), 1);
    assert_eq!(kbs[0].name, "默认知识库");
    assert_eq!(kbs[0].workspace_id, first.id);
    assert_uuid_v7(&kbs[0].id);

    let second = env.create_workspace("ws-second", "个人草稿箱");
    assert!(second.is_current);
    let listed = workspace_service::list(&env.state).expect("工作区列表");
    assert_eq!(listed.len(), 2);
    assert!(listed.iter().filter(|item| item.is_current).count() == 1);

    let switched = workspace_service::switch_workspace(&env.state, &first.id).expect("切回第一个");
    assert!(switched.is_current);
    assert_eq!(
        env.state.current_workspace_id().expect("当前 id"),
        Some(first.id.clone())
    );
    let memory = memory_service::load(&env.state).expect("记忆");
    assert_eq!(memory.get("current_workspace_id"), Some(&first.id));

    // 改名只影响全局显示名，目录不变。
    let renamed = workspace_service::rename(
        &env.state,
        RenameWorkspaceInput {
            id: first.id.clone(),
            name: "改名后的空间".to_string(),
        },
    )
    .expect("重命名");
    assert_eq!(renamed.name, "改名后的空间");
    assert_eq!(renamed.path, first.path);
    assert!(PathBuf::from(&first.path).is_dir());

    // 删除当前工作区：自动切到最近使用的另一个，并按选择删除目录。
    workspace_service::switch_workspace(&env.state, &second.id).expect("切到第二个");
    let deleted = workspace_service::delete(
        &env.state,
        DeleteWorkspaceInput {
            id: second.id.clone(),
            delete_folder: true,
        },
    )
    .expect("删除第二个工作区");
    assert!(deleted.folder_removed);
    assert!(deleted.warning.is_none());
    assert_eq!(
        deleted.next_workspace.as_ref().map(|item| item.id.as_str()),
        Some(first.id.as_str())
    );
    assert!(!PathBuf::from(&second.path).exists());
    assert_eq!(
        env.state.current_workspace_id().expect("当前 id"),
        Some(first.id.clone())
    );

    // 删除最后一个：连接清空、记忆清理，但按选择保留目录。
    let deleted_last = workspace_service::delete(
        &env.state,
        DeleteWorkspaceInput {
            id: first.id.clone(),
            delete_folder: false,
        },
    )
    .expect("删除最后一个工作区");
    assert!(deleted_last.next_workspace.is_none());
    assert!(!deleted_last.folder_removed);
    assert_eq!(env.state.current_workspace_id().expect("当前 id"), None);
    assert!(PathBuf::from(&first.path).is_dir());
    assert!(
        workspace_service::list(&env.state)
            .expect("列表为空")
            .is_empty()
    );
    let memory = memory_service::load(&env.state).expect("记忆");
    assert!(!memory.contains_key("current_workspace_id"));
    let bootstrap = workspace_service::bootstrap(&env.state).expect("引导数据");
    assert!(bootstrap.current_workspace.is_none());
}

#[test]
fn open_requires_valid_structure_and_adopts_existing_workspace() {
    let env = TestEnv::new();
    let invalid = env.dir.path().join("not-a-workspace");
    fs::create_dir_all(&invalid).expect("创建普通目录");
    let error =
        workspace_service::open(&env.state, &invalid.to_string_lossy()).expect_err("应拒绝");
    assert!(matches!(error, AppError::InvalidWorkspace));

    let workspace = env.create_workspace("ws-open", "打开测试");
    workspace_service::clear_current_workspace(&env.state).expect("清空当前");
    let opened = workspace_service::open(&env.state, &workspace.path).expect("重新打开");
    assert_eq!(opened.id, workspace.id);
    assert_eq!(
        workspace_service::list(&env.state).expect("列表").len(),
        1,
        "同一路径不得重复登记"
    );

    // 删除注册但保留目录 → 再次打开时自动登记。
    workspace_service::delete(
        &env.state,
        DeleteWorkspaceInput {
            id: workspace.id.clone(),
            delete_folder: false,
        },
    )
    .expect("仅删除注册");
    assert!(
        PathBuf::from(&workspace.path)
            .join("db/workspace.sqlite3")
            .is_file()
    );
    let adopted = workspace_service::open(&env.state, &workspace.path).expect("接管目录");
    assert!(adopted.is_current);
    assert_ne!(adopted.id, workspace.id, "重新登记应生成新的 UUID v7");
    assert_eq!(workspace_service::list(&env.state).expect("列表").len(), 1);
}

#[test]
fn restart_restores_remembered_workspace_and_theme() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-restart", "重启恢复");
    let global_db = env.global_db.clone();
    let workspace_id = workspace.id.clone();
    let mut entries = BTreeMap::new();
    entries.insert("appearance.theme".to_string(), "azure".to_string());
    entries.insert("appearance.mode".to_string(), "dark".to_string());
    memory_service::save(&env.state, &entries).expect("保存主题记忆");
    drop(env.state);

    let connection = db::global::open(&global_db).expect("重新打开全局库");
    let restored_state = AppState::new(connection, None);
    let restored = workspace_service::restore_last_workspace(&restored_state)
        .expect("恢复")
        .expect("有当前工作区");
    assert_eq!(restored.id, workspace_id);
    assert_eq!(
        restored_state.current_workspace_id().expect("当前 id"),
        Some(workspace_id)
    );
    let memory = memory_service::load(&restored_state).expect("记忆");
    assert_eq!(memory.get("appearance.theme"), Some(&"azure".to_string()));
    assert_eq!(memory.get("appearance.mode"), Some(&"dark".to_string()));
}

#[test]
fn knowledge_base_crud_and_cascade_delete() {
    let env = TestEnv::new();
    env.create_workspace("ws-kb", "知识库测试");
    let default_kb = env.first_kb_id();

    let created = knowledge_base_service::create(
        &env.state,
        CreateKbInput {
            name: "产品灵感库".to_string(),
            description: "交互灵感".to_string(),
        },
    )
    .expect("新建知识库");
    assert_uuid_v7(&created.id);
    assert_eq!(created.doc_count, 0);

    let updated = knowledge_base_service::update(
        &env.state,
        UpdateKbInput {
            id: created.id.clone(),
            name: Some("产品灵感库 2".to_string()),
            description: Some("改过的描述".to_string()),
        },
    )
    .expect("修改知识库");
    assert_eq!(updated.name, "产品灵感库 2");
    assert_eq!(updated.description, "改过的描述");

    env.create_node(&created.id, None, DOC, "需求草稿");
    env.create_node(&created.id, None, FOLDER, "资料夹");
    let listed = knowledge_base_service::get(&env.state, &created.id).expect("查询");
    assert_eq!(listed.doc_count, 1, "docCount 只统计非文件夹节点");

    let deleted = knowledge_base_service::delete(&env.state, &created.id).expect("删除知识库");
    assert_eq!(deleted.deleted_nodes, 2);
    let error = knowledge_base_service::get(&env.state, &created.id).expect_err("已删除");
    assert!(matches!(error, AppError::NotFound(_)));
    assert_eq!(
        knowledge_base_service::list(&env.state)
            .expect("剩余知识库")
            .len(),
        1
    );
    let _ = default_kb;

    let invalid = knowledge_base_service::create(
        &env.state,
        CreateKbInput {
            name: "   ".to_string(),
            description: String::new(),
        },
    )
    .expect_err("空名称应拒绝");
    assert!(matches!(invalid, AppError::Validation(_)));
}

#[test]
fn node_tree_levels_paths_and_folder_rename() {
    let env = TestEnv::new();
    env.create_workspace("ws-tree", "文件树测试");
    let kb_id = env.first_kb_id();

    let folder_a = env.create_node(&kb_id, None, FOLDER, "设计");
    let folder_b = env.create_node(&kb_id, Some(&folder_a.id), FOLDER, "原型");
    let doc_c = env.create_node(&kb_id, Some(&folder_b.id), DOC, "首页");
    let board_d = env.create_node(&kb_id, None, BOARD, "情绪板");

    assert_uuid_v7(&folder_a.id);
    assert_eq!(folder_a.level, 1);
    assert_eq!(folder_a.path, "设计");
    assert_eq!(folder_b.level, 2);
    assert_eq!(folder_b.path, "设计/原型");
    assert_eq!(doc_c.level, 3);
    assert_eq!(doc_c.path, "设计/原型/首页");
    assert_eq!(board_d.level, 1);
    assert_eq!(board_d.path, "情绪板");
    assert_eq!(board_d.sort_order, 1, "根级第二个节点序号为 1");

    // 非文件夹不能有子级。
    let error = node_service::create(
        &env.state,
        CreateNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: Some(doc_c.id.clone()),
            node_type: DOC,
            title: "子文档".to_string(),
        },
    )
    .expect_err("文档不能创建子级");
    assert!(matches!(error, AppError::Validation(_)));

    // 非法标题（路径分隔符）被拒绝。
    let error = node_service::create(
        &env.state,
        CreateNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            node_type: DOC,
            title: "a/b".to_string(),
        },
    )
    .expect_err("标题不能含斜杠");
    assert!(matches!(error, AppError::Validation(_)));

    // 文件夹改名同步所有后代 path，level 不变。
    node_service::update(
        &env.state,
        UpdateNodeInput {
            id: folder_a.id.clone(),
            title: Some("设计系统".to_string()),
            starred: None,
        },
    )
    .expect("改名文件夹");
    let nodes = node_service::list(&env.state, &kb_id).expect("树");
    assert_eq!(find_node(&nodes, &folder_a.id).path, "设计系统");
    assert_eq!(find_node(&nodes, &folder_b.id).path, "设计系统/原型");
    assert_eq!(find_node(&nodes, &doc_c.id).path, "设计系统/原型/首页");
    assert_eq!(find_node(&nodes, &doc_c.id).level, 3);

    // 递归删除：设计系统 + 原型 + 首页 = 3。
    let deleted = node_service::delete(&env.state, &folder_a.id).expect("递归删除");
    assert_eq!(deleted.deleted_count, 3);
    let nodes = node_service::list(&env.state, &kb_id).expect("删除后的树");
    assert_eq!(nodes.len(), 1);
    assert_eq!(nodes[0].id, board_d.id);
}

#[test]
fn node_move_supports_reorder_and_reparent_with_guards() {
    let env = TestEnv::new();
    env.create_workspace("ws-move", "拖拽测试");
    let kb_id = env.first_kb_id();

    let folder_a = env.create_node(&kb_id, None, FOLDER, "A");
    let folder_b = env.create_node(&kb_id, Some(&folder_a.id), FOLDER, "B");
    let doc_c = env.create_node(&kb_id, Some(&folder_b.id), DOC, "C");
    let board_d = env.create_node(&kb_id, None, BOARD, "D");

    // C 拖到根级第一位：[C, D]。
    let moved = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: doc_c.id.clone(),
            parent_id: None,
            index: 0,
        },
    )
    .expect("移动 C 到根级");
    let c = find_node(&moved, &doc_c.id);
    assert_eq!(c.level, 1);
    assert_eq!(c.path, "C");
    assert_eq!(c.sort_order, 0);
    // 根级原有 A、D，移动 C 后重排为 [C, A, D]。
    assert_eq!(find_node(&moved, &folder_a.id).sort_order, 1);
    let d = find_node(&moved, &board_d.id);
    assert_eq!(d.sort_order, 2);

    // B 拖到根级索引 1：[C, B, A, D]。
    let moved = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: folder_b.id.clone(),
            parent_id: None,
            index: 1,
        },
    )
    .expect("移动 B 到根级");
    assert_eq!(find_node(&moved, &folder_b.id).level, 1);
    assert_eq!(find_node(&moved, &folder_b.id).path, "B");
    assert_eq!(find_node(&moved, &folder_b.id).sort_order, 1);
    let root_order: Vec<i64> = moved
        .iter()
        .filter(|node| node.parent_id.is_none())
        .map(|node| node.sort_order)
        .collect();
    assert_eq!(root_order, vec![0, 1, 2, 3]);

    // B 拖回 A 内部，C 再放入 B，验证子树层级与 path。
    node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: folder_b.id.clone(),
            parent_id: Some(folder_a.id.clone()),
            index: 0,
        },
    )
    .expect("B 移入 A");
    let moved = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: doc_c.id.clone(),
            parent_id: Some(folder_b.id.clone()),
            index: 0,
        },
    )
    .expect("C 移入 B");
    let c = find_node(&moved, &doc_c.id);
    assert_eq!(c.level, 3);
    assert_eq!(c.path, "A/B/C");

    // 不能把文件夹移动到自己的后代。
    let error = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: folder_a.id.clone(),
            parent_id: Some(folder_b.id.clone()),
            index: 0,
        },
    )
    .expect_err("禁止移入后代");
    assert!(matches!(error, AppError::Validation(_)));

    // 非文件夹不能作为目标父级。
    let error = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: folder_a.id.clone(),
            parent_id: Some(doc_c.id.clone()),
            index: 0,
        },
    )
    .expect_err("文档不能作为父级");
    assert!(matches!(error, AppError::Validation(_)));

    // 不能跨知识库移动。
    let other_kb = knowledge_base_service::create(
        &env.state,
        CreateKbInput {
            name: "另一个库".to_string(),
            description: String::new(),
        },
    )
    .expect("第二个知识库");
    let other_folder = env.create_node(&other_kb.id, None, FOLDER, "外库文件夹");
    let error = node_service::move_node(
        &env.state,
        MoveNodeInput {
            id: folder_a.id.clone(),
            parent_id: Some(other_folder.id),
            index: 0,
        },
    )
    .expect_err("禁止跨知识库");
    assert!(matches!(error, AppError::Validation(_)));
}

#[test]
fn memory_config_validates_keys_and_theme_values() {
    let env = TestEnv::new();
    env.create_workspace("ws-memory", "记忆测试");

    let mut entries = BTreeMap::new();
    entries.insert("appearance.theme".to_string(), "forest".to_string());
    entries.insert("appearance.mode".to_string(), "dark".to_string());
    entries.insert("custom.flag".to_string(), "on".to_string());
    entries.insert("kb.current.ws-1".to_string(), "kb-1".to_string());
    memory_service::save(&env.state, &entries).expect("保存记忆");
    let loaded = memory_service::load(&env.state).expect("读取记忆");
    assert_eq!(loaded.get("appearance.theme"), Some(&"forest".to_string()));
    assert_eq!(loaded.get("appearance.mode"), Some(&"dark".to_string()));
    assert_eq!(loaded.get("custom.flag"), Some(&"on".to_string()));
    assert_eq!(loaded.get("kb.current.ws-1"), Some(&"kb-1".to_string()));

    let invalid_theme = BTreeMap::from([("appearance.theme".to_string(), "neon".to_string())]);
    assert!(matches!(
        memory_service::save(&env.state, &invalid_theme),
        Err(AppError::Validation(_))
    ));

    let reserved = BTreeMap::from([("current_workspace_id".to_string(), "x".to_string())]);
    assert!(matches!(
        memory_service::save(&env.state, &reserved),
        Err(AppError::Validation(_))
    ));

    let invalid_key = BTreeMap::from([("bad key!".to_string(), "x".to_string())]);
    assert!(matches!(
        memory_service::save(&env.state, &invalid_key),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn document_blocks_save_incrementally_and_roundtrip() {
    let env = TestEnv::new();
    env.create_workspace("ws-doc", "文档存储");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "长文");

    let first_block = paragraph("第一段");
    let second_block = paragraph("第二段");
    let third_block = paragraph("第三段");
    let initial = document(vec![
        first_block.clone(),
        second_block.clone(),
        third_block.clone(),
    ]);

    let first = env.save_doc(&doc.id, initial.clone());
    assert_eq!(first.add.len(), 3);
    assert_eq!(first.tree.len(), 3);
    assert_eq!(first.word_count, 9);
    assert!(!first.order.is_empty(), "首次保存需要给出块顺序");
    assert_tree_ordered(&first);
    let first_ids: Vec<String> = first.tree.iter().map(|node| node.id.clone()).collect();
    let first_orders: Vec<String> = first.tree.iter().map(|node| node.order.clone()).collect();

    let loaded = document_service::load(&env.state, &doc.id).expect("加载文档");
    assert_eq!(loaded.document, initial);
    assert_eq!(loaded.word_count, 9);
    assert_eq!(loaded.updated_at, first.updated_at);
    let loaded_ids: Vec<String> = loaded.tree.iter().map(|node| node.id.clone()).collect();
    assert_eq!(loaded_ids, first_ids);

    // 内容与顺序均未变化：不得新增/删除/重排，实例 id 保持稳定。
    let unchanged = env.save_doc(&doc.id, initial.clone());
    assert!(unchanged.add.is_empty());
    assert!(unchanged.rm.is_empty());
    assert!(unchanged.order.is_empty());
    let unchanged_ids: Vec<String> = unchanged.tree.iter().map(|node| node.id.clone()).collect();
    assert_eq!(unchanged_ids, first_ids);

    // 中间插入：只新增 1 块，锚点 id/order 不变，差量区间为前后锚点。
    let inserted_block = paragraph("插入");
    let inserted = document(vec![
        first_block.clone(),
        inserted_block.clone(),
        second_block.clone(),
        third_block.clone(),
    ]);
    let result = env.save_doc(&doc.id, inserted.clone());
    assert_eq!(result.add.len(), 1);
    assert!(result.rm.is_empty());
    assert_eq!(result.order.len(), 1);
    assert_eq!(result.order[0].after, first_orders[0]);
    assert_eq!(result.order[0].before, first_orders[1]);
    assert_eq!(result.order[0].hash_list, vec![result.add[0].hash.clone()]);
    assert_tree_ordered(&result);
    assert_eq!(result.tree[0].id, first_ids[0]);
    assert_eq!(result.tree[2].id, first_ids[1]);
    assert_eq!(result.tree[3].id, first_ids[2]);

    // 修改第二块：旧 hash 无引用后进入 rm，新 hash 进入 add。
    let replaced = document(vec![
        first_block.clone(),
        inserted_block.clone(),
        paragraph("第二段改"),
        third_block.clone(),
    ]);
    let result = env.save_doc(&doc.id, replaced.clone());
    assert_eq!(result.add.len(), 1);
    assert_eq!(result.rm.len(), 1);
    assert_tree_ordered(&result);
    let loaded = document_service::load(&env.state, &doc.id).expect("加载修改后文档");
    assert_eq!(loaded.document, replaced);

    // 清空文档：块树清空，全部 hash 无引用后删除。
    let empty = document(Vec::new());
    let cleared = env.save_doc(&doc.id, empty.clone());
    assert!(cleared.tree.is_empty());
    assert_eq!(cleared.rm.len(), 4, "清空后四段内容 hash 均无引用");
    let loaded = document_service::load(&env.state, &doc.id).expect("加载空文档");
    assert_eq!(loaded.document, empty);
    assert_eq!(loaded.word_count, 0);
}

#[test]
fn duplicate_blocks_share_hash_and_respect_references() {
    let env = TestEnv::new();
    env.create_workspace("ws-dup", "重复块");
    let kb_id = env.first_kb_id();
    let doc_a = env.create_node(&kb_id, None, DOC, "文档 A");
    let doc_b = env.create_node(&kb_id, None, DOC, "文档 B");
    let shared = paragraph("共享段落");

    let saved = env.save_doc(&doc_a.id, document(vec![shared.clone(), shared.clone()]));
    assert_eq!(saved.add.len(), 1, "重复内容只入 hash 表一次");
    assert_eq!(saved.tree.len(), 2);
    assert_ne!(saved.tree[0].id, saved.tree[1].id, "块实例 id 必须独立");
    assert_eq!(saved.tree[0].hash, saved.tree[1].hash);

    let saved_b = env.save_doc(&doc_b.id, document(vec![shared.clone()]));
    assert!(saved_b.add.is_empty(), "跨文档复用已有 hash");
    assert_eq!(saved_b.tree.len(), 1);

    // 文档 A 删除块后，hash 仍被文档 B 引用，不能进入 rm。
    let removed_a = env.save_doc(&doc_a.id, document(Vec::new()));
    assert!(removed_a.rm.is_empty(), "有引用时不得删除 hash");
    let loaded_b = document_service::load(&env.state, &doc_b.id).expect("加载文档 B");
    assert_eq!(loaded_b.document, document(vec![shared.clone()]));

    // 文档 B 也删除后，hash 才被清理。
    let removed_b = env.save_doc(&doc_b.id, document(Vec::new()));
    assert_eq!(removed_b.rm.len(), 1);
}

#[test]
fn document_save_rejects_non_document_nodes_and_invalid_documents() {
    let env = TestEnv::new();
    env.create_workspace("ws-doc-guard", "文档校验");
    let kb_id = env.first_kb_id();
    let board = env.create_node(&kb_id, None, BOARD, "画板");
    let error = document_service::save(
        &env.state,
        SaveDocumentInput {
            node_id: board.id,
            document: document(Vec::new()),
        },
    )
    .expect_err("画板不能保存文档正文");
    assert!(matches!(error, AppError::Validation(_)));

    let doc = env.create_node(&kb_id, None, DOC, "文档");
    let error = document_service::save(
        &env.state,
        SaveDocumentInput {
            node_id: doc.id,
            document: json!({"type": "paragraph"}),
        },
    )
    .expect_err("根节点必须是 doc");
    assert!(matches!(error, AppError::Validation(_)));
}

#[test]
fn document_blocks_survive_restart() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-doc-restart", "文档重启");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "重启文档");
    let initial = document(vec![paragraph("alpha"), paragraph("beta")]);
    let saved = env.save_doc(&doc.id, initial.clone());

    let global_db = env.global_db.clone();
    let workspace_id = workspace.id.clone();
    let node_id = doc.id.clone();
    drop(env.state);

    let connection = db::global::open(&global_db).expect("重新打开全局库");
    let restored = AppState::new(connection, None);
    workspace_service::switch_workspace(&restored, &workspace_id).expect("恢复工作区");
    let loaded = document_service::load(&restored, &node_id).expect("恢复文档");
    assert_eq!(loaded.document, initial);
    let saved_ids: Vec<String> = saved.tree.iter().map(|node| node.id.clone()).collect();
    let loaded_ids: Vec<String> = loaded.tree.iter().map(|node| node.id.clone()).collect();
    assert_eq!(loaded_ids, saved_ids);
}

#[test]
fn document_save_writes_markdown_and_props_asynchronously() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-doc-meta", "文档元数据");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "元数据文档");
    let content = document(vec![
        json!({"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"章节"}]}),
        paragraph("正文"),
        json!({"type":"bulletList","content":[
            {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"条目"}]}]}
        ]}),
    ]);
    env.save_doc(&doc.id, content);

    let db_path = PathBuf::from(&workspace.path).join("db/workspace.sqlite3");
    let (markdown, prop) = wait_for_meta(&db_path, &doc.id);
    assert!(markdown.contains("## 章节"), "markdown={markdown}");
    assert!(markdown.contains("正文"), "markdown={markdown}");
    assert!(markdown.contains("- 条目"), "markdown={markdown}");
    let prop: Value = serde_json::from_str(&prop).expect("prop 必须是合法 JSON");
    assert_eq!(prop["blockCount"], 3);
    assert_eq!(prop["headingCount"], 1);
    assert_eq!(prop["listCount"], 1);
    assert_eq!(prop["version"], 1);
    assert_eq!(prop["wordCount"], 6, "章节正文条目 = 6 个非空白字符");

    let connection = db::workspace::open_existing(&db_path).expect("打开工作区库");
    let stored_id: String = connection
        .query_row(
            "SELECT id FROM doc_block_meta WHERE id = ?1",
            [&doc.id],
            |row| row.get(0),
        )
        .expect("元数据主键必须与 node.id 一致");
    assert_eq!(stored_id, doc.id);
    let valid: i64 = connection
        .query_row(
            "SELECT json_valid(prop) FROM doc_block_meta WHERE id = ?1",
            [&doc.id],
            |row| row.get(0),
        )
        .expect("prop JSON 校验");
    assert_eq!(valid, 1);
}

#[test]
fn document_meta_ignores_out_of_order_writes() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-doc-meta-race", "元数据乱序");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "乱序文档");
    env.save_doc(&doc.id, document(vec![paragraph("正文")]));
    let db_path = PathBuf::from(&workspace.path).join("db/workspace.sqlite3");
    // 先等本次保存的后台任务落库，避免它用更大的真实时间戳覆盖测试数据。
    wait_for_meta(&db_path, &doc.id);
    let connection = db::workspace::open_existing(&db_path).expect("打开工作区库");
    let (_, _, baseline) = document_repository::find_meta(&connection, &doc.id)
        .expect("读取元数据")
        .expect("元数据存在");

    document_repository::upsert_meta(&connection, &doc.id, "newer", "{}", baseline + 10)
        .expect("写入较新元数据");
    document_repository::upsert_meta(&connection, &doc.id, "stale", "{}", baseline + 5)
        .expect("写入较旧元数据");

    let (markdown, _, update_time) = document_repository::find_meta(&connection, &doc.id)
        .expect("读取元数据")
        .expect("元数据存在");
    assert_eq!(markdown, "newer", "晚到的旧任务不得覆盖新结果");
    assert_eq!(update_time, baseline + 10);
}

#[test]
fn document_load_repairs_legacy_emoji_and_null_attrs() {
    let env = TestEnv::new();
    env.create_workspace("ws-doc-normalize", "文档修复");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "旧文档");
    let dirty = json!({"type":"doc","content":[
        {"type":"paragraph","attrs":{"textAlign":null},"content":[
            {"type":"text","text":"旧"},
            {"type":"emoji","attrs":{"name":null}},
            {"type":"text","text":""}
        ]}
    ]});
    {
        let guard = env.state.workspace().expect("工作区锁");
        let session = guard.as_ref().expect("当前会话");
        session
            .connection
            .execute(
                "UPDATE node SET content = ?2, word_count = 99 WHERE id = ?1",
                rusqlite::params![doc.id, dirty.to_string()],
            )
            .expect("写入历史脏数据");
    }

    let loaded = document_service::load(&env.state, &doc.id).expect("加载旧文档");
    assert!(loaded.normalized, "旧脏数据必须被标记为已修复");
    assert_eq!(
        loaded.document,
        json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"旧"}]}
        ]})
    );
    assert_eq!(loaded.word_count, 1, "修复后按规范化正文重算字数");
    assert!(!loaded.document.to_string().contains(":null:"));

    env.save_doc(&doc.id, loaded.document);
    let reloaded = document_service::load(&env.state, &doc.id).expect("再次加载");
    assert!(!reloaded.normalized, "修复落库后再次加载不应重复标记");
}

// ---------------------------------------------------------------------------
// 附件对象存储
// ---------------------------------------------------------------------------

fn attachment_context(env: &TestEnv) -> AttachmentContext {
    AttachmentContext::from_state(&env.state).expect("附件上下文")
}

fn workspace_db_path(workspace: &WorkspaceDto) -> PathBuf {
    PathBuf::from(&workspace.path).join("db/workspace.sqlite3")
}

fn workspace_storage_path(workspace: &WorkspaceDto) -> PathBuf {
    PathBuf::from(&workspace.path).join("storage")
}

fn write_source(env: &TestEnv, name: &str, bytes: &[u8]) -> PathBuf {
    let path = env.dir.path().join(name);
    fs::write(&path, bytes).expect("写测试源文件");
    path
}

fn upload_file(
    context: &AttachmentContext,
    name: &str,
    source: &Path,
    logical_path: &str,
) -> AttachmentDto {
    attachment_service::upload(
        context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: logical_path.to_string(),
            name: Some(name.to_string()),
            mime: None,
        },
    )
    .expect("上传附件")
}

fn upload_file_with_policy(
    context: &AttachmentContext,
    name: &str,
    source: &Path,
    logical_path: &str,
    policy: StoragePolicy,
) -> AttachmentDto {
    attachment_service::upload_with_policy(
        context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: logical_path.to_string(),
            name: Some(name.to_string()),
            mime: None,
        },
        policy,
    )
    .expect("上传附件")
}

#[test]
fn attachment_big_is_deduped_and_refcount_drives_physical_delete() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-big", "附件大文件");
    let context = attachment_context(&env);
    let content = vec![0x5A_u8; 300 * 1024];
    let source = write_source(&env, "big-source.bin", &content);

    let first = upload_file(&context, "原件.bin", &source, "");
    // 同内容重复上传（名字和目录都换）：两条逻辑记录，一份真实文件。
    let second = upload_file(&context, "副本.bin", &source, "archive");
    let expected_hash = blake3::hash(&content).to_hex().to_string();
    assert_eq!(first.content_hash, expected_hash);
    assert_eq!(second.content_hash, expected_hash);
    assert_ne!(first.id, second.id, "重复上传必须各自成一条记录");
    assert_eq!(second.name, "副本.bin");
    assert_eq!(second.logical_path, "archive");
    assert_eq!(first.size, content.len() as i64);

    let stats_after_dup = attachment_service::stats(&context).expect("重传后统计");
    assert_eq!(stats_after_dup.active_count, 2);
    assert_eq!(stats_after_dup.unique_objects, 1, "真实文件只有一份");
    assert_eq!(stats_after_dup.physical_bytes, content.len() as i64);

    let big_path = workspace_storage_path(&workspace)
        .join("objects/big")
        .join(&expected_hash[0..2])
        .join(&expected_hash[2..4])
        .join(&expected_hash);
    assert!(big_path.is_file(), "big 对象必须落在两级分桶路径");

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let blob = attachment_repository::find_blob(&connection, &expected_hash)
        .expect("查询 blob")
        .expect("blob 存在");
    assert_eq!(blob.storage_kind, "big");
    assert_eq!(
        attachment_repository::count_active_references(&connection, &expected_hash)
            .expect("活跃引用数"),
        2,
        "两条记录共享一个对象"
    );

    let deleted_first = attachment_service::delete(&context, &first.id).expect("删除第一个引用");
    assert_eq!(deleted_first.remaining_references, 1);
    assert!(!deleted_first.physical_deleted);
    assert!(big_path.is_file(), "仍有引用时不得删除物理文件");

    let stats_after_first = attachment_service::stats(&context).expect("统计");
    assert_eq!(stats_after_first.active_count, 1);
    assert_eq!(stats_after_first.deleted_count, 1);
    assert_eq!(stats_after_first.unique_objects, 1);

    let deleted_second =
        attachment_service::delete(&context, &second.id).expect("删除最后一个引用");
    assert_eq!(deleted_second.remaining_references, 0);
    assert!(deleted_second.physical_deleted);
    assert!(!big_path.exists(), "引用归零后 big 文件必须被删除");
    assert!(
        attachment_repository::find_blob(&connection, &expected_hash)
            .expect("再次查询 blob")
            .is_none(),
        "引用归零后 blob 行必须删除"
    );

    let stats = attachment_service::stats(&context).expect("最终统计");
    assert_eq!(stats.active_count, 0);
    assert_eq!(stats.deleted_count, 2);
    assert_eq!(stats.logical_bytes, 0);
    assert_eq!(stats.unique_objects, 0);
    assert_eq!(stats.physical_bytes, 0);

    // 引用归零后重新上传：物理对象与逻辑记录都重建，并拿到新的 id。
    let revived = upload_file(&context, "原件.bin", &source, "");
    assert_ne!(revived.id, first.id, "对象已删除后重传应新建记录");
    assert_eq!(revived.content_hash, expected_hash);
    assert!(big_path.is_file(), "重传必须重新发布物理对象");
}

#[test]
fn attachment_small_uses_pack_and_recovers_unindexed_tail() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-pack", "附件小文件");
    let context = attachment_context(&env);
    let first_content = vec![0x11_u8; 4096];
    let first_source = write_source(&env, "small-a.bin", &first_content);
    let first = upload_file(&context, "a.bin", &first_source, "");
    let first_hash = blake3::hash(&first_content).to_hex().to_string();
    assert_eq!(first.content_hash, first_hash);

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let blob = attachment_repository::find_blob(&connection, &first_hash)
        .expect("查询 blob")
        .expect("blob 存在");
    assert_eq!(blob.storage_kind, "pack");
    let pack_id = blob.pack_id.clone().expect("pack id");
    let pack_path = workspace_storage_path(&workspace)
        .join("objects/small/packs")
        .join(format!("{pack_id}.pack"));
    assert!(pack_path.is_file(), "小对象必须进入 pack");
    let first_end = fs::metadata(&pack_path).expect("pack 元数据").len();

    // 模拟崩溃遗留的未索引尾部：下一次 append 应截断后再写。
    {
        let mut pack = fs::OpenOptions::new()
            .append(true)
            .open(&pack_path)
            .expect("追加垃圾");
        pack.write_all(&[0xFF; 13]).expect("写入未索引尾部");
        pack.sync_all().expect("同步垃圾尾部");
    }
    let second_content = vec![0x22_u8; 2048];
    let second_source = write_source(&env, "small-b.bin", &second_content);
    let second = upload_file(&context, "b.bin", &second_source, "");
    let second_blob = attachment_repository::find_blob(&connection, &second.content_hash)
        .expect("查询第二个 blob")
        .expect("第二个 blob 存在");
    assert_eq!(second_blob.storage_kind, "pack");
    assert_eq!(second_blob.pack_offset, Some(first_end as i64));
    assert_eq!(
        fs::metadata(&pack_path).expect("pack 元数据").len(),
        first_end + second_content.len() as u64,
        "未索引尾部必须被截断"
    );

    let download_path = env.dir.path().join("small-roundtrip.bin");
    let downloaded = attachment_service::download(
        &context,
        DownloadAttachmentInput {
            id: first.id.clone(),
            dest_path: download_path.to_string_lossy().into_owned(),
            overwrite: true,
        },
    )
    .expect("下载 small");
    assert_eq!(downloaded.size, first_content.len() as i64);
    assert_eq!(fs::read(&download_path).expect("读下载文件"), first_content);
    assert!(
        attachment_service::verify(&context, &first.id)
            .expect("校验 small")
            .valid
    );

    // 空文件也进入 pack，读取 0 字节并校验 BLAKE3 空串。
    let empty_source = write_source(&env, "empty.bin", &[]);
    let empty = upload_file(&context, "empty.bin", &empty_source, "");
    assert_eq!(empty.size, 0);
    let empty_dest = env.dir.path().join("empty-roundtrip.bin");
    attachment_service::download(
        &context,
        DownloadAttachmentInput {
            id: empty.id.clone(),
            dest_path: empty_dest.to_string_lossy().into_owned(),
            overwrite: true,
        },
    )
    .expect("下载空文件");
    assert_eq!(fs::read(&empty_dest).expect("读空文件"), Vec::<u8>::new());
    assert!(
        attachment_service::verify(&context, &empty.id)
            .expect("校验空文件")
            .valid
    );
}

#[test]
fn attachment_soft_delete_list_and_path_reuse() {
    let env = TestEnv::new();
    env.create_workspace("ws-attach-delete", "附件删除");
    let context = attachment_context(&env);
    let content = vec![0x33_u8; 1024];
    let source = write_source(&env, "soft-delete.bin", &content);
    let first = upload_file(&context, "note.txt", &source, "docs");

    let deleted = attachment_service::delete(&context, &first.id).expect("软删除");
    assert_eq!(deleted.remaining_references, 0);
    let active =
        attachment_service::list(&context, &AttachmentListQuery::default()).expect("活跃列表");
    assert!(active.is_empty(), "软删除后默认列表不可见");
    let all = attachment_service::list(
        &context,
        &AttachmentListQuery {
            logical_path: None,
            include_deleted: true,
        },
    )
    .expect("全部列表");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].status, "deleted");
    assert!(attachment_service::get(&context, &first.id).is_err());
    assert!(
        attachment_service::download(
            &context,
            DownloadAttachmentInput {
                id: first.id.clone(),
                dest_path: env
                    .dir
                    .path()
                    .join("deleted.bin")
                    .to_string_lossy()
                    .into_owned(),
                overwrite: true,
            }
        )
        .is_err(),
        "删除后的附件不能下载"
    );

    let second = upload_file(&context, "note.txt", &source, "docs");
    assert_ne!(first.id, second.id);
    let active = attachment_service::list(&context, &AttachmentListQuery::default())
        .expect("重新上传后的列表");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, second.id);
}

#[test]
fn attachment_rename_and_move_only_change_metadata() {
    let env = TestEnv::new();
    env.create_workspace("ws-attach-rename", "附件重命名");
    let context = attachment_context(&env);
    let content = vec![0x44_u8; 2048];
    let source = write_source(&env, "rename-source.bin", &content);
    let first = upload_file(&context, "a.txt", &source, "docs");
    let first_hash = first.content_hash.clone();

    let moved = attachment_service::update(
        &context,
        UpdateAttachmentInput {
            id: first.id.clone(),
            name: Some("b.txt".to_string()),
            logical_path: Some("docs/2026".to_string()),
        },
    )
    .expect("重命名并移动");
    assert_eq!(moved.name, "b.txt");
    assert_eq!(moved.logical_path, "docs/2026");
    assert_eq!(moved.content_hash, first_hash);
    assert_eq!(moved.size, first.size);

    let other_source = write_source(&env, "rename-other.bin", &[0x45_u8; 128]);
    let duplicate = upload_file(&context, "b.txt", &other_source, "docs/2026");
    assert_ne!(duplicate.id, moved.id, "同名上传必须各自返回附件 id");
    assert_eq!(duplicate.name, "b.txt");

    let restored = attachment_service::update(
        &context,
        UpdateAttachmentInput {
            id: first.id.clone(),
            name: Some("a.txt".to_string()),
            logical_path: Some("docs".to_string()),
        },
    )
    .expect("移回原路径");
    assert_eq!(restored.name, "a.txt");
    assert_eq!(restored.logical_path, "docs");
    assert!(
        attachment_service::update(
            &context,
            UpdateAttachmentInput {
                id: first.id,
                name: None,
                logical_path: None,
            }
        )
        .is_err()
    );
}

#[test]
fn attachment_allows_duplicate_names_and_returns_distinct_ids() {
    let env = TestEnv::new();
    env.create_workspace("ws-attach-dup-name", "同名附件");
    let context = attachment_context(&env);
    let first_source = write_source(&env, "dup-a.bin", &[0x51_u8; 512]);
    let second_source = write_source(&env, "dup-b.bin", &[0x52_u8; 700]);

    // 同一目录、同一文件名、不同内容：两次上传都要成功。
    let first = upload_file(&context, "image.png", &first_source, "docs");
    let second = upload_file(&context, "image.png", &second_source, "docs");
    assert_ne!(first.id, second.id);
    assert_eq!(first.name, "image.png");
    assert_eq!(second.name, "image.png");
    assert_ne!(first.content_hash, second.content_hash);

    let active =
        attachment_service::list(&context, &AttachmentListQuery::default()).expect("活跃列表");
    assert_eq!(active.len(), 2, "同名附件都要出现在列表里");

    // 同名且同内容：仍各自成一条记录，但指向同一份真实文件。
    let third = upload_file(&context, "image.png", &first_source, "docs");
    assert_ne!(third.id, first.id, "重复上传必须新建记录");
    assert_eq!(third.content_hash, first.content_hash);
    let stats = attachment_service::stats(&context).expect("统计");
    assert_eq!(stats.active_count, 3);
    assert_eq!(stats.unique_objects, 2, "同内容只保留一个物理对象");

    // 换目录重传同内容：新记录、同一对象；目录不参与去重。
    let other_dir = upload_file(&context, "image.png", &first_source, "");
    assert_ne!(other_dir.id, third.id);
    assert_eq!(other_dir.content_hash, first.content_hash);
    let filtered = attachment_service::list(
        &context,
        &AttachmentListQuery {
            logical_path: Some("docs".to_string()),
            include_deleted: false,
        },
    )
    .expect("按目录列出");
    assert_eq!(filtered.len(), 3);

    // 用户实际动作：连续粘贴两张同名剪贴板图片走的是字节上传通道。
    let pasted_first = attachment_service::upload_bytes(
        &context,
        "image.png".to_string(),
        "docs".to_string(),
        Some("image/png".to_string()),
        vec![0x61_u8; 96],
    )
    .expect("第一次粘贴 image.png");
    let pasted_second = attachment_service::upload_bytes(
        &context,
        "image.png".to_string(),
        "docs".to_string(),
        Some("image/png".to_string()),
        vec![0x62_u8; 96],
    )
    .expect("第二次粘贴 image.png 也必须成功");
    assert_ne!(pasted_first.id, pasted_second.id);
    assert_eq!(pasted_first.name, "image.png");
    assert_eq!(pasted_second.name, "image.png");
    assert_ne!(pasted_first.content_hash, pasted_second.content_hash);
    for id in [&pasted_first.id, &pasted_second.id] {
        let fetched = attachment_service::get(&context, id).expect("按 id 回读");
        assert_eq!(fetched.name, "image.png");
    }

    // 连续粘贴同一张图片（字节完全一致）：新记录，但共享同一份真实文件。
    let pasted_again = attachment_service::upload_bytes(
        &context,
        "image.png".to_string(),
        "docs".to_string(),
        Some("image/png".to_string()),
        vec![0x61_u8; 96],
    )
    .expect("重复粘贴同一图片");
    assert_ne!(pasted_again.id, pasted_first.id, "重复粘贴也各自成一条记录");
    assert_eq!(
        pasted_again.content_hash, pasted_first.content_hash,
        "重复粘贴指向同一份真实文件"
    );
}

#[test]
fn attachment_staging_names_temp_file_by_blake3() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-stage-name", "暂存命名");
    let storage_root = workspace_storage_path(&workspace);
    let content = "星屿暂存命名测试".as_bytes().to_vec();
    let hash = blake3::hash(&content).to_hex().to_string();

    let staged = attachment_store::stage_bytes(&content, &storage_root).expect("暂存字节");
    assert_eq!(staged.hash, hash);
    assert_eq!(staged.size, content.len() as u64);
    assert_eq!(
        staged.path.file_name().and_then(|value| value.to_str()),
        Some(format!("{hash}.part").as_str()),
        "临时文件必须以 BLAKE3 命名，不能出现真实文件名"
    );
    assert!(staged.path.is_file());

    let entries: Vec<String> = fs::read_dir(storage_root.join("tmp"))
        .expect("读暂存目录")
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    assert_eq!(
        entries,
        vec![format!("{hash}.part")],
        "暂存区只留哈希名文件，不得残留写入期的临时名"
    );

    // 同内容再暂存一次：复用同一个哈希名，不产生第二个文件。
    let again = attachment_store::stage_bytes(&content, &storage_root).expect("再次暂存");
    assert_eq!(again.path, staged.path);
    attachment_store::cleanup_staged(&staged.path);
    assert!(!staged.path.exists(), "清理后不得残留暂存文件");
}

#[test]
fn attachment_rejects_invalid_paths_and_names() {
    let env = TestEnv::new();
    env.create_workspace("ws-attach-validate", "附件校验");
    let context = attachment_context(&env);
    let source = write_source(&env, "validate-source.bin", &[1, 2, 3]);

    for (logical_path, name) in [("../escape", "x.bin"), ("ok", "bad/name.bin")] {
        let error = attachment_service::upload(
            &context,
            UploadAttachmentInput {
                source_path: source.to_string_lossy().into_owned(),
                logical_path: logical_path.to_string(),
                name: Some(name.to_string()),
                mime: None,
            },
        )
        .expect_err("非法路径/名称必须失败");
        assert!(matches!(error, AppError::Validation(_)));
    }
    let directory = env.dir.path().join("not-a-file");
    fs::create_dir_all(&directory).expect("建目录");
    assert!(
        attachment_service::upload(
            &context,
            UploadAttachmentInput {
                source_path: directory.to_string_lossy().into_owned(),
                logical_path: String::new(),
                name: Some("dir".to_string()),
                mime: None,
            }
        )
        .is_err(),
        "目录不能作为源文件"
    );
    assert!(
        attachment_service::list(&context, &AttachmentListQuery::default())
            .expect("列表")
            .is_empty()
    );
}

#[test]
fn attachment_pack_compaction_keeps_live_objects_readable() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-compact", "附件压缩");
    let context = attachment_context(&env);
    let policy = StoragePolicy {
        small_object_threshold: 128 * 1024,
        pack_roll_bytes: 1024 * 1024 * 1024,
        compaction_dead_ratio: 0.3,
        compaction_min_dead_bytes: 0,
    };
    let no_schedule = StoragePolicy {
        compaction_min_dead_bytes: u64::MAX,
        ..policy
    };
    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let mut uploads = Vec::new();
    for index in 0..8 {
        let content = vec![index as u8 + 1; 8192];
        let source = write_source(&env, &format!("compact-{index}.bin"), &content);
        let uploaded = upload_file_with_policy(
            &context,
            &format!("n{index}.bin"),
            &source,
            "compact",
            policy,
        );
        uploads.push((uploaded, content));
    }
    let active_pack = attachment_repository::find_active_pack(&connection)
        .expect("查活跃 pack")
        .expect("活跃 pack 存在");
    for (uploaded, _) in uploads.iter().take(6) {
        let result = attachment_service::delete_with_policy(&context, &uploaded.id, no_schedule)
            .expect("删除小对象");
        assert!(!result.compaction_scheduled);
    }

    attachment_service::compact_for_test(&context, &active_pack.id, policy)
        .expect("执行 compaction");
    assert!(
        attachment_repository::find_pack(&connection, &active_pack.id)
            .expect("查旧 pack")
            .is_none(),
        "旧 pack 元数据应在无引用后删除"
    );
    let old_pack_path = workspace_storage_path(&workspace)
        .join("objects/small/packs")
        .join(format!("{}.pack", active_pack.id));
    assert!(!old_pack_path.exists(), "旧 pack 文件应删除");

    for (uploaded, content) in uploads.iter().skip(6) {
        let blob = attachment_repository::find_blob(&connection, &uploaded.content_hash)
            .expect("查存活 blob")
            .expect("存活 blob 存在");
        assert_ne!(blob.pack_id.as_deref(), Some(active_pack.id.as_str()));
        let dest = env
            .dir
            .path()
            .join(format!("compact-out-{}.bin", uploaded.id));
        attachment_service::download(
            &context,
            DownloadAttachmentInput {
                id: uploaded.id.clone(),
                dest_path: dest.to_string_lossy().into_owned(),
                overwrite: true,
            },
        )
        .expect("压缩后仍可下载");
        assert_eq!(fs::read(dest).expect("读下载文件"), *content);
        assert!(
            attachment_service::verify(&context, &uploaded.id)
                .expect("校验")
                .valid
        );
    }
    let stats = attachment_service::stats(&context).expect("压缩后统计");
    assert_eq!(stats.dead_pack_bytes, 0, "压缩后不应残留死字节");

    // 压缩期间会创建新的 active pack；后续上传必须落到它并保持可读。
    let extra_content = vec![0xAA_u8; 1024];
    let extra_source = write_source(&env, "compact-extra.bin", &extra_content);
    let extra = upload_file_with_policy(&context, "extra.bin", &extra_source, "compact", policy);
    let active_after = attachment_repository::find_active_pack(&connection)
        .expect("查新活跃 pack")
        .expect("新活跃 pack 存在");
    let extra_blob = attachment_repository::find_blob(&connection, &extra.content_hash)
        .expect("查新 blob")
        .expect("新 blob 存在");
    assert_eq!(
        extra_blob.pack_id.as_deref(),
        Some(active_after.id.as_str())
    );
    assert!(
        attachment_service::verify(&context, &extra.id)
            .expect("校验新附件")
            .valid
    );
}

#[test]
fn attachment_compaction_removes_pack_without_live_objects() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-empty-pack", "附件空包");
    let context = attachment_context(&env);
    let policy = StoragePolicy {
        small_object_threshold: 128 * 1024,
        pack_roll_bytes: 1024 * 1024 * 1024,
        compaction_dead_ratio: 0.3,
        compaction_min_dead_bytes: 0,
    };
    let no_schedule = StoragePolicy {
        compaction_min_dead_bytes: u64::MAX,
        ..policy
    };
    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let mut ids = Vec::new();
    for index in 0..2 {
        let content = vec![index as u8 + 0x30; 4096];
        let source = write_source(&env, &format!("empty-pack-{index}.bin"), &content);
        ids.push(
            upload_file_with_policy(
                &context,
                &format!("empty-pack-{index}.bin"),
                &source,
                "empty",
                policy,
            )
            .id,
        );
    }
    let active_pack = attachment_repository::find_active_pack(&connection)
        .expect("查活跃 pack")
        .expect("活跃 pack 存在");
    for id in &ids {
        attachment_service::delete_with_policy(&context, id, no_schedule).expect("删除");
    }
    attachment_service::compact_for_test(&context, &active_pack.id, policy).expect("清理空 pack");
    assert!(
        attachment_repository::find_pack(&connection, &active_pack.id)
            .expect("查旧 pack")
            .is_none()
    );
    let old_pack = workspace_storage_path(&workspace)
        .join("objects/small/packs")
        .join(format!("{}.pack", active_pack.id));
    assert!(!old_pack.exists(), "无活跃对象的 pack 文件应删除");
}

#[test]
fn attachment_concurrent_same_hash_has_one_physical_object() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-concurrent", "附件并发");
    let context = attachment_context(&env);
    let content = vec![0x77_u8; 1024 * 1024];
    let source = write_source(&env, "concurrent.bin", &content);
    let names: Vec<String> = (0..4)
        .map(|index| format!("concurrent-{index}.bin"))
        .collect();

    let uploaded = std::thread::scope(|scope| {
        let handles: Vec<_> = names
            .iter()
            .map(|name| {
                let context = context.clone();
                let source = source.clone();
                let name = name.clone();
                scope.spawn(move || upload_file(&context, &name, &source, "concurrent"))
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| handle.join().expect("并发上传线程"))
            .collect::<Vec<_>>()
    });

    let expected_hash = blake3::hash(&content).to_hex().to_string();
    assert!(
        uploaded
            .iter()
            .all(|item| item.content_hash == expected_hash)
    );
    assert_eq!(
        uploaded
            .iter()
            .map(|item| item.id.as_str())
            .collect::<std::collections::HashSet<_>>()
            .len(),
        4,
        "并发上传同内容也要各自成一条记录"
    );
    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let blob = attachment_repository::find_blob(&connection, &expected_hash)
        .expect("查询 blob")
        .expect("blob 存在");
    assert_eq!(
        attachment_repository::count_active_references(&connection, &expected_hash)
            .expect("活跃引用数"),
        4,
        "四条记录共享一个对象"
    );
    assert_eq!(blob.storage_kind, "big");
    let big_path = workspace_storage_path(&workspace)
        .join("objects/big")
        .join(&expected_hash[0..2])
        .join(&expected_hash[2..4])
        .join(&expected_hash);
    assert!(big_path.is_file());
    assert_eq!(
        fs::read(&big_path).expect("读 big 对象").len(),
        content.len(),
        "并发下发布的对象字节必须完整"
    );
    let stats = attachment_service::stats(&context).expect("并发统计");
    assert_eq!(stats.active_count, 4);
    assert_eq!(stats.unique_objects, 1, "并发同内容只产生一份真实文件");
    assert_eq!(stats.physical_bytes, content.len() as i64);
    // 暂存区不得留下哈希名文件或写入期临时名。
    let staged_left: Vec<_> = fs::read_dir(workspace_storage_path(&workspace).join("tmp"))
        .expect("读暂存目录")
        .filter_map(|entry| entry.ok())
        .collect();
    assert!(staged_left.is_empty(), "并发上传后暂存区必须清空");
}

#[test]
fn attachment_verify_detects_corruption_and_download_overwrite() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-verify", "附件校验");
    let context = attachment_context(&env);
    let content = vec![0x88_u8; 200 * 1024];
    let source = write_source(&env, "verify-big.bin", &content);
    let big = upload_file(&context, "verify.bin", &source, "");
    assert!(
        attachment_service::verify(&context, &big.id)
            .expect("校验")
            .valid
    );

    let dest = env.dir.path().join("verify-out.bin");
    attachment_service::download(
        &context,
        DownloadAttachmentInput {
            id: big.id.clone(),
            dest_path: dest.to_string_lossy().into_owned(),
            overwrite: false,
        },
    )
    .expect("首次下载");
    assert_eq!(fs::read(&dest).expect("读下载文件"), content);
    let inside_storage = workspace_storage_path(&workspace).join("must-not-write.bin");
    let guarded = attachment_service::download(
        &context,
        DownloadAttachmentInput {
            id: big.id.clone(),
            dest_path: inside_storage.to_string_lossy().into_owned(),
            overwrite: true,
        },
    )
    .expect_err("下载目标不能落在附件存储目录");
    assert!(matches!(guarded, AppError::Validation(_)));
    assert!(
        attachment_service::download(
            &context,
            DownloadAttachmentInput {
                id: big.id.clone(),
                dest_path: dest.to_string_lossy().into_owned(),
                overwrite: false,
            }
        )
        .is_err(),
        "目标存在且未允许覆盖时必须失败"
    );
    attachment_service::download(
        &context,
        DownloadAttachmentInput {
            id: big.id.clone(),
            dest_path: dest.to_string_lossy().into_owned(),
            overwrite: true,
        },
    )
    .expect("允许覆盖时下载");
    assert_eq!(fs::read(&dest).expect("读覆盖文件"), content);

    let hash = big.content_hash.clone();
    let big_path = workspace_storage_path(&workspace)
        .join("objects/big")
        .join(&hash[0..2])
        .join(&hash[2..4])
        .join(&hash);
    {
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(&big_path)
            .expect("打开 big");
        file.write_all(&[0xEE]).expect("追加损坏字节");
        file.sync_all().expect("同步损坏字节");
    }
    let verify = attachment_service::verify(&context, &big.id).expect("校验损坏 big");
    assert!(!verify.valid);
    assert!(verify.message.is_some());

    let small_content = vec![0x99_u8; 4096];
    let small_source = write_source(&env, "verify-small.bin", &small_content);
    let small = upload_file(&context, "verify-small.bin", &small_source, "small");
    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let small_blob = attachment_repository::find_blob(&connection, &small.content_hash)
        .expect("查询 small blob")
        .expect("small blob 存在");
    let pack_path = workspace_storage_path(&workspace)
        .join("objects/small/packs")
        .join(format!("{}.pack", small_blob.pack_id.expect("pack id")));
    let offset = small_blob.pack_offset.expect("offset") as u64;
    {
        let mut pack = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&pack_path)
            .expect("打开 pack");
        pack.seek(SeekFrom::Start(offset)).expect("定位 pack 条目");
        let mut byte = [0_u8; 1];
        std::io::Read::read_exact(&mut pack, &mut byte).expect("读 pack 字节");
        byte[0] ^= 0xFF;
        pack.seek(SeekFrom::Start(offset)).expect("回到 pack 条目");
        pack.write_all(&byte).expect("写损坏字节");
        pack.sync_all().expect("同步损坏字节");
    }
    let verify = attachment_service::verify(&context, &small.id).expect("校验损坏 pack");
    assert!(!verify.valid);
}

#[test]
fn attachment_bytes_upload_and_image_preview_roundtrip() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-bytes", "附件字节上传");
    let context = attachment_context(&env);
    let bytes = vec![0x89_u8, 0x50, 0x4E, 0x47, 1, 2, 3, 4];
    let uploaded = attachment_service::upload_bytes(
        &context,
        "pixel.png".to_string(),
        "images".to_string(),
        Some("image/png".to_string()),
        bytes.clone(),
    )
    .expect("字节上传");
    assert_eq!(uploaded.name, "pixel.png");
    assert_eq!(uploaded.mime, "image/png");
    assert_eq!(uploaded.size, bytes.len() as i64);
    assert_eq!(
        attachment_service::read_bytes(&context, &uploaded.id).expect("读取预览"),
        bytes
    );

    let text = attachment_service::upload_bytes(
        &context,
        "note.txt".to_string(),
        String::new(),
        Some("text/plain".to_string()),
        b"hello".to_vec(),
    )
    .expect("文本附件");
    assert!(
        attachment_service::read_bytes(&context, &text.id).is_err(),
        "非图片附件不得作为图片预览读取"
    );

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let blob = attachment_repository::find_blob(&connection, &uploaded.content_hash)
        .expect("查询 blob")
        .expect("blob 存在");
    assert_eq!(blob.storage_kind, "pack", "小图片应进入 pack");
    assert_eq!(
        attachment_repository::count_active_references(&connection, &uploaded.content_hash)
            .expect("活跃引用数"),
        1
    );
}

#[test]
fn document_attachment_nodes_roundtrip_and_derive_markdown() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attachment-nodes", "附件块文档");
    let kb_id = env.first_kb_id();
    let node = env.create_node(&kb_id, None, DOC, "附件块文档");
    let value = document(vec![
        json!({
            "type": "attachmentImage",
            "attrs": {
                "attachmentId": "img-1",
                "name": "封面.png",
                "size": 1024,
                "mime": "image/png",
                "alt": "封面",
                "width": 360,
                "align": "center"
            }
        }),
        json!({
            "type": "attachmentBlock",
            "attrs": {
                "variant": "grid",
                "align": "left",
                "items": [
                    {"uid": "u1", "attachmentId": "att-1", "name": "报告.pdf", "size": 10, "mime": "application/pdf"},
                    {"uid": "u2", "attachmentId": "att-2", "name": "数据.json", "size": 20, "mime": "application/json"}
                ]
            }
        }),
    ]);
    let saved = env.save_doc(&node.id, value.clone());
    assert_eq!(saved.tree.len(), 2, "两个顶层附件块都必须入块树");

    let loaded = document_service::load(&env.state, &node.id).expect("重新加载附件块文档");
    assert_eq!(loaded.document["content"][0]["type"], "attachmentImage");
    assert_eq!(loaded.document["content"][0]["attrs"]["align"], "center");
    assert_eq!(
        loaded.document["content"][1]["attrs"]["items"]
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    let (markdown, prop) = wait_for_meta(&workspace_db_path(&workspace), &node.id);
    assert!(
        markdown.contains("![封面](attachment://img-1)"),
        "{markdown}"
    );
    assert!(
        markdown.contains("- [报告.pdf](attachment://att-1)"),
        "{markdown}"
    );
    let prop: Value = serde_json::from_str(&prop).expect("prop JSON");
    assert_eq!(prop["imageCount"], 1);
    assert_eq!(prop["attachmentCount"], 2);
}
