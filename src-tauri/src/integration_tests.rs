//! 服务层集成测试：真实临时 SQLite + 真实工作区目录，不 mock 数据库。
//!
//! 覆盖工作区生命周期、统一切换入口、知识库级联、文件树层级/path/排序与拖拽约束、
//! 记忆配置与“重启后恢复”。测试通过后仍需在真实 Tauri 应用做黑盒冒烟。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use tempfile::TempDir;
use uuid::Uuid;

use crate::db;
use crate::errors::AppError;
use crate::models::{
    CreateKbInput, CreateNodeInput, CreateWorkspaceInput, DeleteWorkspaceInput, DocSaveResult,
    MoveNodeInput, NodeDto, RenameWorkspaceInput, SaveDocumentInput, UpdateKbInput,
    UpdateNodeInput, WorkspaceDto,
};
use crate::repositories::document_repository;
use crate::services::{
    document_service, knowledge_base_service, memory_service, node_service, workspace_service,
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
