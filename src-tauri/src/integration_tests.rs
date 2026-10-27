//! 服务层集成测试：真实临时 SQLite + 真实工作区目录，不 mock 数据库。
//!
//! 覆盖工作区生命周期、统一切换入口、知识库级联、文件树层级/path/排序与拖拽约束、
//! 记忆配置与“重启后恢复”。测试通过后仍需在真实 Tauri 应用做黑盒冒烟。

use std::collections::BTreeMap;
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::{Value, json};
use tempfile::TempDir;
use uuid::Uuid;

use crate::db;
use crate::domain::attachment::StoragePolicy;
use crate::errors::AppError;
use crate::models::attachment::MaintenanceSettingsInput;
use crate::models::attachment::{
    AttachmentDto, AttachmentLifecycleInput, AttachmentListQuery, DownloadAttachmentInput,
    UpdateAttachmentInput, UploadAttachmentInput,
};
use crate::models::backup::{BackupWorkspaceInput, RestoreWorkspaceInput};
use crate::models::board::{BoardSaveInput, BoardSaveViewportInput};
use crate::models::exchange::ImportMode;
use crate::models::history::RestoreDocHistoryInput;
use crate::models::library::{ImportLibraryInput, SetLibraryEnabledInput};
use crate::models::mindmap::{
    MindmapContent, MindmapSaveInput, MindmapStructure, MindmapTheme, MindmapTopic,
};
use crate::models::search::SearchNodesInput;
use crate::models::template::{CreateFromTemplateInput, SaveTemplateInput};
use crate::models::{
    CreateAttachmentNodeInput, CreateKbInput, CreateNodeInput, CreateWorkspaceInput,
    DeleteWorkspaceInput, DocSaveResult, ExportDocumentInput, ExportFormat,
    ExportKnowledgeBaseInput, ExportWriteFileInput, ImportDocumentsInput, MoveNodeInput, NodeDto,
    RenameWorkspaceInput, SaveDocumentInput, UpdateKbInput, UpdateNodeInput, WorkspaceDto,
};
use crate::repositories::attachment_repository;
use crate::repositories::document_repository;
use crate::services::ai_service;
use crate::services::attachment_maintenance_service::{self, MaintenancePolicy};
use crate::services::attachment_service::{self, AttachmentContext};
use crate::services::{
    attachment_store, backup_service, board_service, document_history_service, document_service,
    export_service, import_service, knowledge_base_service, library_service, memory_service,
    mindmap_format, mindmap_import_service, mindmap_service, node_service, search_service,
    template_service, workspace_service,
};
use crate::state::AppState;
use crate::utils::now_ms;

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
        // 直接读版本，避免 load 触发一次“空正文”元数据回填，干扰 wait_for_meta 的时序。
        let base_version = {
            let guard = self.state.workspace().expect("工作区会话");
            let session = guard.as_ref().expect("已打开工作区");
            session
                .connection
                .query_row(
                    "SELECT doc_version FROM node WHERE id = ?1",
                    [node_id],
                    |row| row.get(0),
                )
                .expect("读取文档版本")
        };
        document_service::save(
            &self.state,
            SaveDocumentInput {
                node_id: node_id.to_string(),
                document,
                base_version,
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
fn document_history_snapshot_and_restore() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-history", "历史");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "历史文档");
    let first = document(vec![paragraph("第一版内容")]);
    env.save_doc(&doc.id, first.clone());

    // 让第一份快照超出 10 分钟间隔，再保存第二版。
    db::workspace::open_existing(&workspace_db_path(&workspace))
        .expect("打开库")
        .execute(
            "UPDATE doc_history SET created_at = 0 WHERE node_id = ?1",
            [&doc.id],
        )
        .expect("推进快照时间");
    env.save_doc(&doc.id, document(vec![paragraph("第二版内容")]));

    let history = document_history_service::list(&env.state, &doc.id).expect("历史列表");
    assert_eq!(history.len(), 2);
    let first_snapshot = history.last().expect("最早快照");
    document_history_service::restore(
        &env.state,
        RestoreDocHistoryInput {
            node_id: doc.id.clone(),
            history_id: first_snapshot.id.clone(),
        },
    )
    .expect("恢复历史");
    let loaded = document_service::load(&env.state, &doc.id).expect("加载恢复后文档");
    assert_eq!(loaded.document, first);
    assert!(loaded.version >= 3);
}

#[test]
fn template_save_list_create_and_delete_document() {
    let env = TestEnv::new();
    env.create_workspace("ws-template", "模板库");
    let kb_id = env.first_kb_id();
    let source = env.create_node(&kb_id, None, DOC, "模板源文档");
    let content = document(vec![paragraph("模板正文"), paragraph("第二段")]);
    env.save_doc(&source.id, content.clone());

    let template = template_service::save(
        &env.state,
        SaveTemplateInput {
            node_id: source.id.clone(),
            name: "会议模板".to_string(),
        },
    )
    .expect("保存模板");
    assert_eq!(template.kind, "doc");
    assert_eq!(
        template_service::list(&env.state).expect("模板列表").len(),
        1
    );

    let created = template_service::create_node(
        &env.state,
        CreateFromTemplateInput {
            template_id: template.id.clone(),
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            title: "从模板创建".to_string(),
        },
    )
    .expect("从模板创建");
    let loaded = document_service::load(&env.state, &created.node.id).expect("读取模板文档");
    assert_eq!(loaded.document, content);

    template_service::delete(&env.state, &template.id).expect("删除模板");
    assert!(
        template_service::list(&env.state)
            .expect("模板列表")
            .is_empty()
    );
    assert!(
        template_service::save(
            &env.state,
            SaveTemplateInput {
                node_id: source.id,
                name: " ".to_string(),
            }
        )
        .is_err()
    );
}

#[test]
fn workspace_backup_and_restore_roundtrip() {
    let env = TestEnv::new();
    env.create_workspace("ws-backup", "备份源");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "备份文档");
    env.save_doc(&doc.id, document(vec![paragraph("备份正文")]));
    let context = attachment_context(&env);
    let source = write_source(&env, "backup.bin", &[0x37; 200 * 1024]);
    let attachment = upload_file(&context, "backup.bin", &source, "");

    let backup_parent = env.dir.path().join("backup-dest");
    fs::create_dir_all(&backup_parent).expect("备份父目录");
    let backup = backup_service::backup(
        &env.state,
        BackupWorkspaceInput {
            dest_dir: backup_parent.to_string_lossy().into_owned(),
        },
    )
    .expect("备份");
    assert!(Path::new(&backup.path).join("backup.json").is_file());
    assert!(
        Path::new(&backup.path)
            .join("db/workspace.sqlite3")
            .is_file()
    );

    let target = env.dir.path().join("restored");
    let restored = backup_service::restore(
        &env.state,
        RestoreWorkspaceInput {
            backup_dir: backup.path.clone(),
            target_dir: target.to_string_lossy().into_owned(),
        },
    )
    .expect("恢复")
    .workspace;
    assert_eq!(
        Path::new(&restored.path).canonicalize().expect("恢复路径"),
        target.canonicalize().expect("目标路径")
    );
    let nodes = node_service::list(&env.state, &env.first_kb_id()).expect("恢复后节点");
    assert!(
        nodes.iter().any(|node| node.title == "备份文档"),
        "恢复后文档节点必须存在"
    );
    let restored_context = attachment_context(&env);
    let attachments = attachment_service::list(&restored_context, &AttachmentListQuery::default())
        .expect("恢复附件");
    assert!(
        attachments.iter().any(|item| item.id == attachment.id),
        "恢复后附件逻辑行必须存在"
    );
    let verified =
        attachment_service::verify(&restored_context, &attachment.id).expect("恢复后校验附件");
    assert!(verified.valid, "恢复后附件字节必须可读");

    let non_empty = env.dir.path().join("non-empty");
    fs::create_dir_all(&non_empty).expect("非空目录");
    fs::write(non_empty.join("keep.txt"), b"keep").expect("非空文件");
    assert!(
        backup_service::restore(
            &env.state,
            RestoreWorkspaceInput {
                backup_dir: backup.path,
                target_dir: non_empty.to_string_lossy().into_owned(),
            }
        )
        .is_err(),
        "恢复目标非空必须拒绝"
    );
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

    let locale = BTreeMap::from([("appearance.locale".to_string(), "en-US".to_string())]);
    memory_service::save(&env.state, &locale).expect("保存英文语言");
    assert_eq!(
        memory_service::load(&env.state).expect("读取语言")["appearance.locale"],
        "en-US"
    );
    let bad_locale = BTreeMap::from([("appearance.locale".to_string(), "fr-FR".to_string())]);
    assert!(matches!(
        memory_service::save(&env.state, &bad_locale),
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
fn search_indexes_titles_and_documents_and_removes_stale_rows() {
    let env = TestEnv::new();
    env.create_workspace("ws-search", "检索");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "星屿检索验证");
    env.save_doc(&doc.id, document(vec![paragraph("穿过正文的关键词")]));

    let search = |query: &str| {
        search_service::search(
            &env.state,
            SearchNodesInput {
                query: query.to_string(),
                knowledge_base_id: kb_id.clone(),
                limit: 20,
            },
        )
        .expect("搜索")
    };

    let long = search("检索验");
    assert!(
        long.iter().any(|hit| hit.node_id == doc.id),
        "3 字标题必须命中"
    );
    let short = search("检索");
    assert!(
        short.iter().any(|hit| hit.node_id == doc.id),
        "2 字必须 LIKE 回退命中"
    );
    let body = search("关键词");
    assert!(
        body.iter().any(|hit| hit.node_id == doc.id),
        "正文必须进入索引"
    );
    assert!(!body[0].snippet.is_empty(), "正文命中必须返回片段");

    node_service::update(
        &env.state,
        UpdateNodeInput {
            id: doc.id.clone(),
            title: Some("改名后的文档".to_string()),
            starred: None,
        },
    )
    .expect("改名");
    assert!(
        search("检索验").iter().all(|hit| hit.node_id != doc.id),
        "旧标题不得残留"
    );
    assert!(
        search("改名后").iter().any(|hit| hit.node_id == doc.id),
        "新标题必须命中"
    );

    node_service::delete(&env.state, &doc.id).expect("删除文档");
    assert!(
        search("改名后").iter().all(|hit| hit.node_id != doc.id),
        "删除节点后索引必须清理"
    );
}

#[test]
fn document_save_rejects_stale_version() {
    let env = TestEnv::new();
    env.create_workspace("ws-doc-version", "文档版本");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "并发文档");

    let first = env.save_doc(&doc.id, document(vec![paragraph("第一版")]));
    assert_eq!(first.version, 1, "首次保存从 0 升到 1");
    let loaded = document_service::load(&env.state, &doc.id).expect("加载文档");
    assert_eq!(loaded.version, 1);
    assert_eq!(loaded.document, document(vec![paragraph("第一版")]));

    // 另一个实例仍拿着旧版本 0 保存：必须冲突，不能覆盖第一版。
    let stale = document_service::save(
        &env.state,
        SaveDocumentInput {
            node_id: doc.id.clone(),
            document: document(vec![paragraph("旧实例覆盖")]),
            base_version: 0,
        },
    )
    .expect_err("旧版本必须冲突");
    assert!(matches!(stale, AppError::Conflict(_)));

    let still = document_service::load(&env.state, &doc.id).expect("冲突后加载");
    assert_eq!(still.version, 1);
    assert_eq!(still.document, document(vec![paragraph("第一版")]));

    let next = document_service::save(
        &env.state,
        SaveDocumentInput {
            node_id: doc.id.clone(),
            document: document(vec![paragraph("第二版")]),
            base_version: 1,
        },
    )
    .expect("最新版本可以保存");
    assert_eq!(next.version, 2);
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
            base_version: 0,
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
            base_version: 0,
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
            scope: None,
            ttl_seconds: None,
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
            scope: None,
            ttl_seconds: None,
        },
        policy,
    )
    .expect("上传附件")
}

#[test]
fn attachment_tree_node_rename_delete_and_export() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-tree", "附件树");
    let kb_id = env.first_kb_id();
    let context = attachment_context(&env);
    let source = write_source(&env, "tree-notes.txt", b"tree attachment");
    let attachment = attachment_service::upload(
        &context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: String::new(),
            name: Some("tree-notes.txt".to_string()),
            mime: Some("text/plain".to_string()),
            scope: Some("node".to_string()),
            ttl_seconds: None,
        },
    )
    .expect("上传树附件");
    let node = node_service::create_attachment_node(
        &env.state,
        CreateAttachmentNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            object_id: attachment.id.clone(),
        },
    )
    .expect("创建附件节点");
    assert_eq!(node.node_type, 6);
    assert_eq!(node.title, "tree-notes.txt");

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE node_id = ?1 AND object_id = ?2",
            rusqlite::params![node.id, attachment.id],
            |row| row.get(0),
        )
        .expect("附件节点引用");
    assert_eq!(references, 1);

    node_service::update(
        &env.state,
        UpdateNodeInput {
            id: node.id.clone(),
            title: Some("重命名附件.txt".to_string()),
            starred: None,
        },
    )
    .expect("重命名附件节点");
    let attachment_name: String = connection
        .query_row(
            "SELECT name FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("附件名称");
    assert_eq!(
        attachment_name, "重命名附件.txt",
        "节点重命名必须同步下载名"
    );

    let export_dir = env.dir.path().join("export-attachment-tree");
    fs::create_dir_all(&export_dir).expect("导出目录");
    let result = export_service::export_knowledge_base(
        &env.state,
        ExportKnowledgeBaseInput {
            knowledge_base_id: kb_id,
            format: ExportFormat::Markdown,
            dest_dir: export_dir.to_string_lossy().into_owned(),
        },
    )
    .expect("整库导出");
    assert_eq!(
        result.attachment_nodes.len(),
        1,
        "附件节点必须写入 manifest"
    );
    let exported = PathBuf::from(&result.attachment_nodes[0].path);
    assert!(exported.is_file(), "附件节点必须按树位置导出");
    assert_eq!(fs::read(&exported).expect("读导出附件"), b"tree attachment");
    let manifest: Value = serde_json::from_slice(
        &fs::read(PathBuf::from(&result.root_path).join("manifest.json")).expect("读 manifest"),
    )
    .expect("manifest JSON");
    assert_eq!(manifest["attachmentNodes"][0]["nodeId"], node.id);
    assert_eq!(manifest["attachmentNodes"][0]["title"], "重命名附件.txt");

    // 导出目录重新导入：manifest 驱动恢复附件节点，而不是把文件当普通文档。
    let second_kb = knowledge_base_service::create(
        &env.state,
        CreateKbInput {
            name: "导入附件树".to_string(),
            description: String::new(),
        },
    )
    .expect("第二个知识库");
    let imported = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: second_kb.id.clone(),
            parent_id: None,
            paths: vec![result.root_path.clone()],
            mode: ImportMode::Directory,
            preserve_hierarchy: true,
        },
    )
    .expect("导入导出目录");
    assert!(imported.imported >= 1, "附件节点必须计入导入结果");
    let imported_nodes = node_service::list(&env.state, &second_kb.id).expect("导入节点");
    let imported_attachment = imported_nodes
        .iter()
        .find(|entry| entry.node_type == 6)
        .expect("附件节点已恢复");
    assert_eq!(imported_attachment.title, "重命名附件.txt");
    let restored = attachment_service::get_by_node(&context, &imported_attachment.id)
        .expect("按附件节点读取对象");
    assert_eq!(restored.name, "重命名附件.txt");
    let verified = attachment_service::verify(&context, &restored.id).expect("校验恢复对象");
    assert!(verified.valid);

    node_service::delete(&env.state, &node.id).expect("删除附件节点");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("回收站引用");
    assert_eq!(references, 1, "回收站期间保留附件引用");
    let orphaned: Option<i64> = connection
        .query_row(
            "SELECT orphaned_at FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("孤儿时间");
    assert!(orphaned.is_none(), "回收站期间不得标记孤儿");

    node_service::trash_purge(&env.state, &node.id).expect("永久删除附件节点");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("永久删除后引用");
    assert_eq!(references, 0);
    let orphaned: Option<i64> = connection
        .query_row(
            "SELECT orphaned_at FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("孤儿时间");
    assert!(orphaned.is_some());
}

#[test]
fn document_refs_cascade_and_attachment_trash_restore() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-attach-refs", "附件引用闭环");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "带附件文档");
    let context = attachment_context(&env);
    let source = write_source(&env, "refs.txt", b"attachment lifecycle");

    let attachment = attachment_service::upload(
        &context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: String::new(),
            name: Some("refs.txt".to_string()),
            mime: Some("text/plain".to_string()),
            scope: Some("node".to_string()),
            ttl_seconds: None,
        },
    )
    .expect("上传节点附件");
    let content = document(vec![json!({
        "type": "attachmentBlock",
        "attrs": {
            "attachmentId": attachment.id,
            "name": attachment.name,
            "size": attachment.size,
            "mime": attachment.mime
        }
    })]);
    env.save_doc(&doc.id, content);

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");
    let reference_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE node_id = ?1 AND object_id = ?2",
            rusqlite::params![doc.id, attachment.id],
            |row| row.get(0),
        )
        .expect("引用数");
    assert_eq!(reference_count, 1, "文档保存必须同步附件引用");

    let blocked =
        attachment_service::delete(&context, &attachment.id).expect_err("被引用附件不能直接删除");
    assert!(matches!(blocked, AppError::Conflict(_)), "{blocked:?}");

    node_service::delete(&env.state, &doc.id).expect("删除文档");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("删除后引用数");
    assert_eq!(references, 1, "回收站期间文档引用仍在");
    let orphaned: Option<i64> = connection
        .query_row(
            "SELECT orphaned_at FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("孤儿时间");
    assert!(orphaned.is_none(), "回收站期间不得标记孤儿");

    node_service::trash_purge(&env.state, &doc.id).expect("永久删除文档");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("永久删除后引用数");
    assert_eq!(references, 0);
    let orphaned: Option<i64> = connection
        .query_row(
            "SELECT orphaned_at FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("孤儿时间");
    assert!(orphaned.is_some(), "失去最后一个引用必须标记孤儿");

    let deleted = attachment_service::delete(&context, &attachment.id).expect("移入回收站");
    assert!(!deleted.physical_deleted);
    assert!(
        attachment_repository::find_blob(&connection, &attachment.content_hash)
            .expect("blob")
            .is_some(),
        "回收站必须保留物理对象"
    );
    let restored = attachment_service::restore(&context, &attachment.id).expect("恢复附件");
    assert_eq!(restored.status, "active");

    attachment_service::set_lifecycle(
        &context,
        AttachmentLifecycleInput {
            id: attachment.id.clone(),
            ttl_seconds: Some(1),
        },
    )
    .expect("设置 TTL");
    attachment_maintenance_service::run(
        &context,
        now_ms() + 2_000,
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 60_000,
            staging_max_age_ms: 0,
            storage_policy: StoragePolicy::default(),
        },
    )
    .expect("TTL 维护");
    let status: String = connection
        .query_row(
            "SELECT status FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("TTL 后状态");
    assert_eq!(status, "deleted", "TTL 到期应进入回收站");

    attachment_maintenance_service::run(
        &context,
        now_ms() + 4_000,
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 0,
            storage_policy: StoragePolicy::default(),
        },
    )
    .expect("回收站维护");
    let remaining: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM attachment WHERE id = ?1",
            [&attachment.id],
            |row| row.get(0),
        )
        .expect("purge 后行数");
    assert_eq!(remaining, 0, "保留期结束必须 purge");
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
    assert_eq!(deleted_first.remaining_references, 0);
    assert!(!deleted_first.physical_deleted);
    assert!(big_path.is_file(), "回收站保留期内不得删除物理文件");

    let stats_after_first = attachment_service::stats(&context).expect("统计");
    assert_eq!(stats_after_first.active_count, 1);
    assert_eq!(stats_after_first.deleted_count, 1);
    assert_eq!(stats_after_first.unique_objects, 1);
    assert_eq!(stats_after_first.trash_count, 1);

    let deleted_second = attachment_service::delete(&context, &second.id).expect("删除第二条");
    assert_eq!(deleted_second.remaining_references, 0);
    assert!(!deleted_second.physical_deleted);
    assert!(big_path.is_file(), "软删除必须保留对象以支持恢复");
    assert!(
        attachment_repository::find_blob(&connection, &expected_hash)
            .expect("再次查询 blob")
            .is_some(),
        "回收站期间 blob 行必须保留"
    );

    // 保留期设为 0：维护任务将回收站行与无引用物理对象一并清理。
    let maintenance = attachment_maintenance_service::run(
        &context,
        now_ms() + 1,
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 0,
            storage_policy: StoragePolicy::default(),
        },
    )
    .expect("执行维护");
    assert_eq!(maintenance.purged, 2);
    assert!(!big_path.exists(), "purge 后 big 文件必须被删除");
    assert!(
        attachment_repository::find_blob(&connection, &expected_hash)
            .expect("再次查询 blob")
            .is_none(),
        "purge 后 blob 行必须删除"
    );

    let stats = attachment_service::stats(&context).expect("最终统计");
    assert_eq!(stats.active_count, 0);
    assert_eq!(stats.deleted_count, 0);
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
            ..Default::default()
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
            ..Default::default()
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
                scope: None,
                ttl_seconds: None,
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
                scope: None,
                ttl_seconds: None,
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
        let result = attachment_service::delete(&context, &uploaded.id).expect("删除小对象");
        assert!(!result.compaction_scheduled);
    }

    attachment_maintenance_service::run(
        &context,
        now_ms() + 1,
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 0,
            storage_policy: policy,
        },
    )
    .expect("执行维护与 compaction");
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
        attachment_service::delete(&context, id).expect("删除");
    }
    attachment_maintenance_service::run(
        &context,
        now_ms() + 1,
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 0,
            storage_policy: policy,
        },
    )
    .expect("清理空 pack");
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
fn maintenance_settings_roundtrip_validation_and_policy() {
    let env = TestEnv::new();
    env.create_workspace("maintenance-settings", "保留策略");
    let context = attachment_context(&env);

    let defaults = attachment_maintenance_service::settings(&context).expect("默认策略");
    assert_eq!(defaults.orphan_grace_days, 7);
    assert_eq!(defaults.trash_retention_days, 30);
    assert_eq!(defaults.staging_max_age_hours, 24);

    let saved = attachment_maintenance_service::update_settings(
        &context,
        MaintenanceSettingsInput {
            orphan_grace_days: 3,
            trash_retention_days: 10,
            staging_max_age_hours: 12,
        },
    )
    .expect("保存策略");
    assert_eq!(saved.orphan_grace_days, 3);
    assert_eq!(saved.trash_retention_days, 10);
    assert_eq!(saved.staging_max_age_hours, 12);

    let policy = attachment_maintenance_service::load_policy(&context).expect("读取策略");
    assert_eq!(policy.orphan_grace_ms, 3 * 24 * 60 * 60 * 1000);
    assert_eq!(policy.trash_retention_ms, 10 * 24 * 60 * 60 * 1000);
    assert_eq!(policy.staging_max_age_ms, 12 * 60 * 60 * 1000);

    let invalid = attachment_maintenance_service::update_settings(
        &context,
        MaintenanceSettingsInput {
            orphan_grace_days: 0,
            trash_retention_days: 10,
            staging_max_age_hours: 12,
        },
    )
    .expect_err("0 天必须拒绝");
    assert!(matches!(invalid, AppError::Validation(_)));

    // 损坏或非正数的历史值回退默认，不让维护线程停摆。
    {
        let connection = context.connection().expect("连接");
        attachment_repository::set_meta(&connection, "attachment.orphan_grace_days", "abc")
            .expect("写入损坏值");
        attachment_repository::set_meta(&connection, "attachment.trash_retention_days", "0")
            .expect("写入零值");
    }
    let fallback = attachment_maintenance_service::settings(&context).expect("回退策略");
    assert_eq!(fallback.orphan_grace_days, 7);
    assert_eq!(fallback.trash_retention_days, 30);
    assert_eq!(fallback.staging_max_age_hours, 12);
}

#[test]
fn maintenance_delete_serializes_with_same_hash_upload() {
    let env = TestEnv::new();
    env.create_workspace("ws-attach-race", "附件并发维护");
    let base = attachment_context(&env);
    let content = vec![0x99_u8; 300 * 1024];
    let source = write_source(&env, "race-source.bin", &content);
    // 先制造一条回收站记录，让维护线程每轮都有真实删除工作。
    let seed = upload_file(&base, "seed.bin", &source, "");
    attachment_service::delete(&base, &seed.id).expect("种子附件删除");

    let make_context = |context: &AttachmentContext| AttachmentContext {
        storage_root: context.storage_root.clone(),
        db_path: context.db_path.clone(),
        lock: context.lock.clone(),
    };
    let upload_context = make_context(&base);
    let maintenance_context = make_context(&base);
    let source_path = source.to_string_lossy().into_owned();

    let uploader = std::thread::spawn(move || {
        for index in 0..24 {
            let item = attachment_service::upload(
                &upload_context,
                UploadAttachmentInput {
                    source_path: source_path.clone(),
                    logical_path: String::new(),
                    name: Some(format!("race-{index}.bin")),
                    mime: None,
                    scope: None,
                    ttl_seconds: None,
                },
            )
            .expect("并发上传");
            let verified =
                attachment_service::verify(&upload_context, &item.id).expect("校验活跃对象");
            assert!(verified.valid, "并发上传后的对象必须可读 index={index}");
            match attachment_service::delete(&upload_context, &item.id) {
                Ok(_) => {}
                // 维护可能已清掉回收站行；这不是失败。
                Err(AppError::NotFound(_)) => {}
                Err(error) => panic!("删除并发附件失败: {error}"),
            }
        }
    });
    let maintainer = std::thread::spawn(move || {
        for _ in 0..24 {
            attachment_maintenance_service::run(
                &maintenance_context,
                now_ms(),
                MaintenancePolicy {
                    orphan_grace_ms: 0,
                    trash_retention_ms: 0,
                    // 不清理正在上传的 staging 文件；本测试只验证回收站删除与上传竞态。
                    staging_max_age_ms: 24 * 60 * 60 * 1000,
                    storage_policy: StoragePolicy::default(),
                },
            )
            .expect("并发维护");
        }
    });

    uploader.join().expect("上传线程");
    maintainer.join().expect("维护线程");
}

fn set_file_age(path: &Path, age: Duration) {
    let file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("打开测试文件");
    file.set_modified(SystemTime::now() - age)
        .expect("设置测试文件时间");
}

#[test]
fn maintenance_removes_unreferenced_doc_hashes() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-doc-gc", "块哈希回收");
    let kb_id = env.first_kb_id();
    let doc = env.create_node(&kb_id, None, DOC, "待删除文档");
    env.save_doc(&doc.id, document(vec![paragraph("只属于这篇文档的块")]));

    let db_path = workspace_db_path(&workspace);
    let before: i64 = db::workspace::open_existing(&db_path)
        .expect("打开库")
        .query_row("SELECT COUNT(*) FROM doc_block_hash", [], |row| row.get(0))
        .expect("hash 计数");
    assert_eq!(before, 1);

    node_service::delete(&env.state, &doc.id).expect("删除文档");
    node_service::trash_purge(&env.state, &doc.id).expect("永久删除文档");
    let context = attachment_context(&env);
    let result = attachment_maintenance_service::run(
        &context,
        now_ms(),
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 24 * 60 * 60 * 1000,
            storage_policy: StoragePolicy::default(),
        },
    )
    .expect("维护");

    assert_eq!(result.doc_hashes_removed, 1);
    let after: i64 = db::workspace::open_existing(&db_path)
        .expect("打开库")
        .query_row("SELECT COUNT(*) FROM doc_block_hash", [], |row| row.get(0))
        .expect("hash 计数");
    assert_eq!(after, 0);
}

#[test]
fn maintenance_quarantines_untracked_objects_and_prunes_old_quarantine() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("ws-orphan-file", "孤儿文件");
    let context = attachment_context(&env);
    let source = write_source(&env, "known.bin", &[0x41; 512]);
    upload_file(&context, "known.bin", &source, "");
    let storage = workspace_storage_path(&workspace);

    let big_dir = storage.join("objects/big/aa/aa");
    fs::create_dir_all(&big_dir).expect("big 目录");
    let stray_big = big_dir.join("aa".repeat(32));
    fs::write(&stray_big, b"stray-big").expect("写入孤儿 big");
    set_file_age(&stray_big, Duration::from_secs(25 * 60 * 60));

    let recent_big = big_dir.join("bb".repeat(32));
    fs::write(&recent_big, b"recent-big").expect("写入新 big");

    let pack_dir = storage.join("objects/small/packs");
    fs::create_dir_all(&pack_dir).expect("pack 目录");
    let stray_pack = pack_dir.join("orphan.pack");
    fs::write(&stray_pack, b"stray-pack").expect("写入孤儿 pack");
    set_file_age(&stray_pack, Duration::from_secs(25 * 60 * 60));

    let old_quarantine = storage.join("quarantine/1");
    fs::create_dir_all(&old_quarantine).expect("旧隔离目录");
    fs::write(old_quarantine.join("old.txt"), b"old").expect("旧隔离文件");

    let result = attachment_maintenance_service::run(
        &context,
        now_ms(),
        MaintenancePolicy {
            orphan_grace_ms: 0,
            trash_retention_ms: 0,
            staging_max_age_ms: 24 * 60 * 60 * 1000,
            storage_policy: StoragePolicy::default(),
        },
    )
    .expect("维护");

    assert_eq!(result.orphan_files, 2, "只隔离超过 24h 的无 DB 行文件");
    assert_eq!(result.quarantine_removed, 1, "清理过期隔离目录");
    assert!(!stray_big.exists(), "孤儿 big 必须移走");
    assert!(!stray_pack.exists(), "孤儿 pack 必须移走");
    assert!(recent_big.exists(), "新文件不得误移");
    assert!(!old_quarantine.exists(), "过期隔离目录必须删除");
    let known_packs = fs::read_dir(&pack_dir)
        .expect("pack 目录")
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "pack"))
        .count();
    assert!(known_packs >= 1, "有 DB 行的 pack 必须保留");
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

// ───────────────────────── 导出 / 导入（第十二轮） ─────────────────────────

const PNG_1X1: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4xsAAAAASUVORK5CYII=";

fn png_bytes() -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(PNG_1X1)
        .expect("1x1 png")
}

fn export_doc_with_attachment(env: &TestEnv, title: &str) -> (String, AttachmentDto) {
    let kb_id = env.first_kb_id();
    let node = env.create_node(&kb_id, None, DOC, title);
    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let attachment = attachment_service::upload_bytes(
        &context,
        "封面.png".to_string(),
        "attach".to_string(),
        Some("image/png".to_string()),
        png_bytes(),
    )
    .expect("上传图片");
    let value = document(vec![
        json!({"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "导出标题"}]}),
        paragraph("正文内容"),
        json!({
            "type": "attachmentImage",
            "attrs": {
                "attachmentId": attachment.id,
                "name": "封面.png",
                "size": 70,
                "mime": "image/png",
                "alt": "封面",
                "width": 0,
                "align": "left"
            }
        }),
        json!({
            "type": "attachmentBlock",
            "attrs": {
                "variant": "list",
                "align": "left",
                "items": [{
                    "attachmentId": attachment.id,
                    "name": "封面.png",
                    "size": 70,
                    "mime": "image/png"
                }]
            }
        }),
    ]);
    env.save_doc(&node.id, value);
    (node.id, attachment)
}

#[test]
fn export_document_supports_markdown_html_docx_pdf_and_attachments() {
    let env = TestEnv::new();
    env.create_workspace("ws-export", "导出工作区");
    let (node_id, _attachment) = export_doc_with_attachment(&env, "导出测试");

    for format in [
        ExportFormat::Markdown,
        ExportFormat::Html,
        ExportFormat::Docx,
        ExportFormat::Pdf,
    ] {
        let dir = env
            .dir
            .path()
            .join(format!("export-{}", format.extension()));
        fs::create_dir_all(&dir).expect("导出目录");
        let dest = dir.join(format!("文档.{}", format.extension()));
        let result = export_service::export_document(
            &env.state,
            ExportDocumentInput {
                node_id: node_id.clone(),
                format,
                dest_path: dest.to_string_lossy().into_owned(),
            },
        )
        .expect("导出成功");
        assert!(dest.is_file(), "缺少 {} 输出", format.label());
        assert!(
            result.files.iter().any(|file| file.kind == "attachment"),
            "{} 未导出附件",
            format.label()
        );
        assert!(
            dir.join("attach").join("封面.png").is_file(),
            "{} 的附件未落在 attach/",
            format.label()
        );
        let bytes = fs::read(&dest).expect("读取导出文件");
        match format {
            ExportFormat::Markdown => {
                let text = String::from_utf8(bytes).expect("markdown");
                assert!(text.contains("attach/"), "markdown={text}");
                assert!(
                    !text.contains("attachment://"),
                    "markdown 附件 token 未替换"
                );
            }
            ExportFormat::Html => {
                let text = String::from_utf8(bytes).expect("html");
                assert!(text.contains("attach/"), "html 未引用附件");
            }
            ExportFormat::Docx => assert!(bytes.starts_with(b"PK"), "docx 不是 zip 包"),
            ExportFormat::Pdf => assert!(bytes.starts_with(b"%PDF"), "pdf 文件头不正确"),
        }
    }
}

#[test]
fn export_knowledge_base_preserves_tree_and_all_attachments() {
    let env = TestEnv::new();
    env.create_workspace("ws-export-tree", "整库导出");
    let kb_id = env.first_kb_id();
    let folder = env.create_node(&kb_id, None, FOLDER, "设计");
    let doc = env.create_node(&kb_id, Some(&folder.id), DOC, "首页");
    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let referenced = attachment_service::upload_bytes(
        &context,
        "树附件.txt".to_string(),
        "attach".to_string(),
        Some("text/plain".to_string()),
        b"referenced".to_vec(),
    )
    .expect("上传文档附件");
    env.save_doc(
        &doc.id,
        document(vec![
            paragraph("树导出"),
            json!({
                "type": "attachmentBlock",
                "attrs": {
                    "variant": "list",
                    "align": "left",
                    "items": [{
                        "attachmentId": referenced.id,
                        "name": referenced.name,
                        "size": referenced.size,
                        "mime": referenced.mime,
                    }],
                },
            }),
        ]),
    );

    attachment_service::upload_bytes(
        &context,
        "未引用.txt".to_string(),
        "loose".to_string(),
        Some("text/plain".to_string()),
        b"orphan".to_vec(),
    )
    .expect("上传未引用附件");

    let dest = env.dir.path().join("tree-export");
    fs::create_dir_all(&dest).expect("导出根目录");
    let result = export_service::export_knowledge_base(
        &env.state,
        ExportKnowledgeBaseInput {
            knowledge_base_id: kb_id.clone(),
            format: ExportFormat::Markdown,
            dest_dir: dest.to_string_lossy().into_owned(),
        },
    )
    .expect("整库导出成功");
    let root = PathBuf::from(&result.root_path);
    assert!(root.join("设计").join("首页.md").is_file(), "树层级未保留");
    let tree_attachment = result
        .files
        .iter()
        .find(|file| file.kind == "attachment" && file.path.ends_with("树附件.txt"))
        .expect("文档引用附件未出现在导出清单");
    assert!(
        tree_attachment.path.contains("/设计/attach/"),
        "{}",
        tree_attachment.path
    );
    assert!(Path::new(&tree_attachment.path).is_file());
    assert!(root.join("manifest.json").is_file(), "缺少 manifest");
    assert!(root.join("导出说明.md").is_file(), "缺少导出说明");
    assert!(
        root.join("_attachments")
            .join("loose")
            .join("未引用.txt")
            .is_file(),
        "未引用附件未导出"
    );
    let manifest: Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).expect("manifest"))
            .expect("json");
    assert_eq!(manifest["knowledgeBase"]["id"], kb_id);
    assert!(
        manifest["files"]
            .as_array()
            .is_some_and(|files| !files.is_empty())
    );
}

#[test]
fn import_markdown_preserves_blocks_images_and_original_file() {
    let env = TestEnv::new();
    env.create_workspace("ws-import-md", "导入 Markdown");
    let source_dir = env.dir.path().join("md-source");
    fs::create_dir_all(&source_dir).expect("md 源目录");
    let image_path = source_dir.join("本地图.png");
    fs::write(&image_path, png_bytes()).expect("写图片");
    let markdown = "# 导入标题\n\n正文 **粗体** 与 `代码`。\n\n- 项目一\n- 项目二\n  - 子项\n\n| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |\n\n![本地图](本地图.png)\n\n脚注引用[^1]\n\n[^1]: 脚注内容\n";
    let file = source_dir.join("导入.md");
    fs::write(&file, markdown).expect("写 markdown");

    let result = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: env.first_kb_id(),
            parent_id: None,
            paths: vec![file.to_string_lossy().into_owned()],
            mode: ImportMode::Files,
            preserve_hierarchy: true,
        },
    )
    .expect("导入成功");
    assert_eq!(result.imported, 1, "{:?}", result.files);
    assert_eq!(result.failed, 0);
    let node_id = result.files[0].node_id.clone().expect("节点 id");
    let loaded = document_service::load(&env.state, &node_id).expect("加载导入文档");
    let content = loaded.document["content"].as_array().expect("content");
    let types = content
        .iter()
        .filter_map(|node| node.get("type").and_then(Value::as_str))
        .collect::<Vec<_>>();
    assert!(types.contains(&"heading"), "{types:?}");
    assert!(types.contains(&"bulletList"), "{types:?}");
    assert!(types.contains(&"table"), "{types:?}");
    assert!(types.contains(&"attachmentImage"), "{types:?}");
    assert!(
        types.contains(&"attachmentBlock"),
        "原始文件附件缺失：{types:?}"
    );
    let bullet = content
        .iter()
        .find(|node| node["type"] == "bulletList")
        .expect("无序列表");
    let second = &bullet["content"][1];
    assert_eq!(second["content"][0]["type"], "paragraph");
    assert_eq!(second["content"][0]["content"][0]["text"], "项目二");
    assert_eq!(second["content"][1]["type"], "bulletList");
    assert_eq!(
        second["content"][1]["content"][0]["content"][0]["content"][0]["text"],
        "子项"
    );
    assert!(
        result.files[0].attachment_count >= 2,
        "图片与原始文件都应附件化：{}",
        result.files[0].attachment_count
    );

    // 同一文件再次导入：标题与附件名都要自动去重，不能触发附件唯一约束。
    let repeated = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: env.first_kb_id(),
            parent_id: None,
            paths: vec![file.to_string_lossy().into_owned()],
            mode: ImportMode::Files,
            preserve_hierarchy: true,
        },
    )
    .expect("重复导入成功");
    assert_eq!(repeated.imported, 1, "{:?}", repeated.files);
    assert_eq!(repeated.failed, 0);
    assert_eq!(
        repeated.files[0].attachment_count, result.files[0].attachment_count,
        "重复导入的附件数量应一致"
    );
}

#[test]
fn import_word_and_directory_hierarchy_work() {
    let env = TestEnv::new();
    env.create_workspace("ws-import-word", "导入 Word");
    let source_dir = env.dir.path().join("word-source");
    fs::create_dir_all(source_dir.join("子目录")).expect("源目录");

    let docx_path = source_dir.join("子目录").join("报告.docx");
    let file = fs::File::create(&docx_path).expect("创建 docx");
    docx_rs::Docx::new()
        .add_paragraph(
            docx_rs::Paragraph::new()
                .style("Heading1")
                .add_run(docx_rs::Run::new().add_text("Word 标题")),
        )
        .add_paragraph(docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text("Word 正文")))
        .add_paragraph(
            docx_rs::Paragraph::new()
                .add_run(docx_rs::Run::new().add_image(docx_rs::Pic::new(&png_bytes()))),
        )
        .build()
        .pack(file)
        .expect("写 docx");
    fs::write(source_dir.join("说明.md"), "# 子目录说明\n\n正文").expect("写 md");

    let result = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: env.first_kb_id(),
            parent_id: None,
            paths: vec![source_dir.to_string_lossy().into_owned()],
            mode: ImportMode::Directory,
            preserve_hierarchy: true,
        },
    )
    .expect("目录导入成功");
    assert_eq!(result.failed, 0, "{:?}", result.files);
    assert_eq!(result.imported, 2);
    assert_eq!(result.created_folder_ids.len(), 2, "根目录与子目录都应创建");

    let docx_result = result
        .files
        .iter()
        .find(|file| file.source_path.ends_with("报告.docx"))
        .expect("docx 结果");
    let node_id = docx_result.node_id.clone().expect("docx 节点");
    let loaded = document_service::load(&env.state, &node_id).expect("加载 docx");
    let content = loaded.document["content"].as_array().expect("content");
    assert!(
        content.iter().any(|node| node["type"] == "heading"),
        "{content:?}"
    );
    assert!(
        content.iter().any(|node| node["type"] == "paragraph"),
        "{content:?}"
    );
    assert!(
        content.iter().any(|node| node["type"] == "attachmentImage"),
        "Word 图片未导入：{content:?}"
    );
    assert!(
        content.iter().any(|node| node["type"] == "attachmentBlock"),
        "原始 docx 未附加：{content:?}"
    );
}

#[test]
fn board_scene_roundtrip_filters_deleted_and_guards_version() {
    let env = TestEnv::new();
    env.create_workspace("board-roundtrip", "画板往返");
    let kb_id = env.first_kb_id();
    let board = env.create_node(&kb_id, None, BOARD, "测试画板");

    let elements = json!([
        {"id": "r1", "type": "rectangle", "x": 0, "y": 0, "isDeleted": false},
        {"id": "gone", "type": "rectangle", "x": 10, "y": 10, "isDeleted": true}
    ]);
    let saved = board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: board.id.clone(),
            base_version: 0,
            elements,
            app_state: json!({
                "gridModeEnabled": true,
                "viewBackgroundColor": "#ffffff",
                "scrollX": 999,
                "unknown": "drop"
            }),
        },
    )
    .expect("首次保存画板");
    assert_eq!(saved.version, 1);
    assert_eq!(saved.element_count, 1, "已删除图元不落库");

    let loaded = board_service::load(&env.state, &board.id).expect("加载画板");
    assert_eq!(loaded.version, 1);
    assert_eq!(loaded.elements.as_array().expect("元素数组").len(), 1);
    assert_eq!(loaded.app_state["gridModeEnabled"], true);
    assert!(
        loaded.app_state.get("scrollX").is_none(),
        "视口不得写入 app_state"
    );
    assert!(
        loaded.app_state.get("unknown").is_none(),
        "非白名单字段必须丢弃"
    );
    assert_eq!(loaded.viewport.zoom, 1.0);

    let conflict = board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: board.id.clone(),
            base_version: 0,
            elements: json!([]),
            app_state: json!({}),
        },
    )
    .expect_err("旧版本必须冲突");
    assert!(matches!(conflict, AppError::Conflict(_)), "{conflict:?}");

    let doc = env.create_node(&kb_id, None, DOC, "普通文档");
    let wrong_type = board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: doc.id,
            base_version: 0,
            elements: json!([]),
            app_state: json!({}),
        },
    )
    .expect_err("文档节点不能按画板保存");
    assert!(matches!(wrong_type, AppError::Validation(_)));
}

#[test]
fn node_network_lists_backlinks_and_related_from_search_index() {
    let env = TestEnv::new();
    env.create_workspace("node-network", "知识网络");
    let kb_id = env.first_kb_id();
    let target = env.create_node(&kb_id, None, DOC, "目标文档");
    let source = env.create_node(&kb_id, None, DOC, "知识网络源文档");
    env.save_doc(
        &source.id,
        document(vec![paragraph("这里引用了目标文档的内容")]),
    );
    let unrelated = env.create_node(&kb_id, None, DOC, "完全无关");
    env.save_doc(&unrelated.id, document(vec![paragraph("另一件事")]));

    let network = search_service::network(&env.state, &target.id).expect("知识网络");
    assert!(
        network.backlinks.iter().any(|item| item.id == source.id),
        "正文提到标题必须进入反向链接"
    );
    assert!(
        network.related.iter().any(|item| item.id == source.id),
        "主题相近必须进入相关推荐"
    );
    assert!(
        network
            .backlinks
            .iter()
            .chain(network.related.iter())
            .all(|item| item.id != target.id),
        "不得推荐自身"
    );
    assert!(
        network
            .backlinks
            .iter()
            .chain(network.related.iter())
            .all(|item| item.id != unrelated.id),
        "无相似内容不得硬凑推荐"
    );

    node_service::delete(&env.state, &source.id).expect("删除来源");
    let network = search_service::network(&env.state, &target.id).expect("删除后知识网络");
    assert!(
        network.backlinks.iter().all(|item| item.id != source.id),
        "回收站内容不得出现在知识网络"
    );
}

#[test]
fn table_and_flow_nodes_reuse_document_and_board_services() {
    let env = TestEnv::new();
    env.create_workspace("table-flow", "表格流程图");
    let kb_id = env.first_kb_id();

    let table = env.create_node(&kb_id, None, 4, "测试表格");
    let loaded = document_service::load(&env.state, &table.id).expect("加载表格");
    let table_node = &loaded.document["content"][0];
    assert_eq!(table_node["type"], "table", "表格默认内容应为表格");
    let rows = table_node["content"].as_array().expect("表格行数组");
    assert_eq!(rows.len(), 3, "默认 3 行");
    assert!(
        rows.iter().all(|row| row["content"]
            .as_array()
            .is_some_and(|cells| cells.len() == 3)),
        "默认 3 列"
    );
    assert_eq!(rows[0]["content"][0]["type"], "tableHeader", "首行为表头");

    let mut document = loaded.document.clone();
    document["content"][0]["content"][0]["content"][0]["content"] = json!([paragraph("表格测试")]);
    let saved = env.save_doc(&table.id, document);
    assert!(saved.word_count > 0, "表格正文应计入字数");
    let reloaded = document_service::load(&env.state, &table.id).expect("重新加载表格");
    assert!(
        reloaded.document.to_string().contains("表格测试"),
        "表格内容必须可保存并读回"
    );

    let flow = env.create_node(&kb_id, None, 5, "测试流程图");
    let saved = board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: flow.id.clone(),
            base_version: 0,
            elements: json!([{"id": "f1", "type": "rectangle", "x": 0, "y": 0}]),
            app_state: json!({}),
        },
    )
    .expect("流程图按画板保存");
    assert_eq!(saved.element_count, 1);
    let loaded = board_service::load(&env.state, &flow.id).expect("加载流程图");
    assert_eq!(loaded.elements.as_array().expect("元素数组").len(), 1);
}

#[test]
fn node_trash_restores_subtree_and_purge_releases_attachments() {
    let env = TestEnv::new();
    env.create_workspace("node-trash", "节点回收站");
    let kb_id = env.first_kb_id();
    let folder = env.create_node(&kb_id, None, FOLDER, "回收站文件夹");
    let doc = env.create_node(&kb_id, Some(&folder.id), DOC, "回收站文档");
    env.save_doc(&doc.id, document(vec![paragraph("回收内容")]));

    let context = attachment_context(&env);
    let source = write_source(&env, "trash-purge.bin", b"trash");
    let attachment = attachment_service::upload(
        &context,
        UploadAttachmentInput {
            source_path: source.to_string_lossy().into_owned(),
            logical_path: String::new(),
            name: Some("trash-purge.bin".to_string()),
            mime: None,
            scope: Some("node".to_string()),
            ttl_seconds: None,
        },
    )
    .expect("上传附件");
    let attachment_node = node_service::create_attachment_node(
        &env.state,
        CreateAttachmentNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: Some(folder.id.clone()),
            object_id: attachment.id.clone(),
        },
    )
    .expect("附件节点");

    let deleted = node_service::delete(&env.state, &folder.id).expect("移入回收站");
    assert_eq!(deleted.deleted_count, 3);
    let nodes = node_service::list(&env.state, &kb_id).expect("树");
    assert!(nodes.is_empty(), "回收站内容不得出现在文件树");
    assert!(
        document_service::load(&env.state, &doc.id).is_err(),
        "回收站文档不可打开"
    );
    let hits = search_service::search(
        &env.state,
        SearchNodesInput {
            query: "回收内容".to_string(),
            knowledge_base_id: kb_id.clone(),
            limit: 20,
        },
    )
    .expect("搜索");
    assert!(hits.is_empty(), "回收站内容不应出现在搜索");

    let trash = node_service::trash_list(&env.state, &kb_id).expect("回收站列表");
    assert_eq!(trash.len(), 1, "只列根节点");
    assert_eq!(trash[0].id, folder.id);
    assert_eq!(trash[0].node_type, FOLDER);

    let restored = node_service::restore(&env.state, &folder.id).expect("恢复");
    assert_eq!(restored.restored_count, 3);
    let nodes = node_service::list(&env.state, &kb_id).expect("恢复后树");
    assert_eq!(nodes.len(), 3);
    assert!(nodes.iter().any(|node| node.id == attachment_node.id));
    let loaded = document_service::load(&env.state, &doc.id).expect("恢复后文档");
    assert!(loaded.document.to_string().contains("回收内容"));
    let hits = search_service::search(
        &env.state,
        SearchNodesInput {
            query: "回收内容".to_string(),
            knowledge_base_id: kb_id.clone(),
            limit: 20,
        },
    )
    .expect("恢复后搜索");
    assert_eq!(hits.len(), 1, "恢复后必须重建正文索引");

    node_service::delete(&env.state, &folder.id).expect("再次删除");
    let trash = node_service::trash_list(&env.state, &kb_id).expect("回收站列表");
    let purged = node_service::trash_purge(&env.state, &trash[0].id).expect("永久删除");
    assert_eq!(purged.deleted_count, 3);
    assert!(
        node_service::list(&env.state, &kb_id)
            .expect("树")
            .is_empty()
    );
    let orphaned: Option<i64> = {
        let guard = env.state.workspace().expect("工作区");
        let connection = &guard.as_ref().expect("会话").connection;
        connection
            .query_row(
                "SELECT orphaned_at FROM attachment WHERE id = ?1",
                [&attachment.id],
                |row| row.get(0),
            )
            .expect("附件行")
    };
    assert!(orphaned.is_some(), "永久删除后附件必须进入孤儿流程");
}

#[test]
fn node_trash_blocks_child_restore_and_purges_expired_roots() {
    let env = TestEnv::new();
    env.create_workspace("node-trash-expiry", "回收站清理");
    let kb_id = env.first_kb_id();
    let folder = env.create_node(&kb_id, None, FOLDER, "上级文件夹");
    let child = env.create_node(&kb_id, Some(&folder.id), DOC, "下级文档");

    node_service::delete(&env.state, &child.id).expect("先删下级");
    node_service::delete(&env.state, &folder.id).expect("再删上级");
    let blocked = node_service::restore(&env.state, &child.id).expect_err("上级在回收站时不能恢复");
    assert!(matches!(blocked, AppError::Validation(_)));

    node_service::restore(&env.state, &folder.id).expect("恢复上级");
    let nodes = node_service::list(&env.state, &kb_id).expect("恢复后树");
    assert_eq!(nodes.len(), 2, "先后删除的下级也应随上级恢复");

    node_service::delete(&env.state, &folder.id).expect("再次删除");
    {
        let guard = env.state.workspace().expect("工作区");
        let connection = &guard.as_ref().expect("会话").connection;
        connection
            .execute(
                "UPDATE node SET deleted_at = ?2 WHERE id = ?1",
                rusqlite::params![folder.id, now_ms() - 31 * 24 * 60 * 60 * 1000],
            )
            .expect("回拨删除时间");
    }
    let purged = node_service::purge_expired_trash(&env.state, 30).expect("清理过期回收站");
    assert_eq!(purged, 2);
    assert!(
        node_service::list(&env.state, &kb_id)
            .expect("树")
            .is_empty()
    );
}

#[test]
fn board_images_use_global_object_ids_and_report_missing_objects() {
    let env = TestEnv::new();
    let workspace = env.create_workspace("board-objects", "画板对象");
    let kb_id = env.first_kb_id();
    let board = env.create_node(&kb_id, None, BOARD, "对象画板");

    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let image = attachment_service::upload_bytes(
        &context,
        "image.png".to_string(),
        "画板".to_string(),
        Some("image/png".to_string()),
        vec![0x89, b'P', b'N', b'G', 1, 2, 3],
    )
    .expect("上传画板图片");

    let saved = board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: board.id.clone(),
            base_version: 0,
            elements: json!([
                {
                    "id": "img-1",
                    "type": "image",
                    "fileId": image.id,
                    "customData": {"boardObject": true},
                    "isDeleted": false
                },
                {
                    "id": "card-1",
                    "type": "rectangle",
                    "customData": {
                        "boardFileCard": true,
                        "objectId": "missing-object",
                        "name": "报告.pdf",
                        "mime": "application/pdf",
                        "size": 10
                    },
                    "isDeleted": false
                }
            ]),
            app_state: json!({}),
        },
    )
    .expect("保存带对象的画板");
    assert_eq!(saved.element_count, 2);

    let loaded = board_service::load(&env.state, &board.id).expect("加载带对象的画板");
    assert_eq!(loaded.files.len(), 1, "图片对象必须回填");
    assert_eq!(loaded.files[0].id, image.id, "fileId 就是全局 object_id");
    assert!(
        loaded.files[0]
            .data_url
            .starts_with("data:image/png;base64,"),
        "{}",
        loaded.files[0].data_url
    );
    assert_eq!(
        loaded.missing_object_ids,
        vec!["missing-object".to_string()]
    );

    let viewport = board_service::save_viewport(
        &env.state,
        BoardSaveViewportInput {
            node_id: board.id.clone(),
            scroll_x: 12.5,
            scroll_y: -30.0,
            zoom: 1.5,
        },
    )
    .expect("保存视口");

    let connection = db::workspace::open_existing(&workspace_db_path(&workspace)).expect("附件库");

    assert_eq!(viewport.zoom, 1.5);
    let loaded = board_service::load(&env.state, &board.id).expect("再次加载");
    assert_eq!(loaded.version, saved.version, "视口不得递增场景版本");
    assert_eq!(loaded.viewport.scroll_x, 12.5);
    assert_eq!(loaded.viewport.scroll_y, -30.0);
    assert_eq!(loaded.viewport.zoom, 1.5);

    let version: i64 = {
        let guard = env.state.workspace().expect("工作区锁");
        guard
            .as_ref()
            .expect("工作区存在")
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("读取 schema 版本")
    };
    assert_eq!(version, 15, "工作区库必须升级到 v15");

    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE node_id = ?1 AND object_id = ?2",
            rusqlite::params![board.id, image.id],
            |row| row.get(0),
        )
        .expect("画板引用数");
    assert_eq!(references, 1, "画板保存必须同步图片引用");

    board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: board.id.clone(),
            base_version: saved.version,
            elements: json!([]),
            app_state: json!({}),
        },
    )
    .expect("清空画板");
    let references: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM node_attachment WHERE object_id = ?1",
            [&image.id],
            |row| row.get(0),
        )
        .expect("清空后引用数");
    assert_eq!(references, 0, "移除图元必须释放引用");
    let orphaned: Option<i64> = connection
        .query_row(
            "SELECT orphaned_at FROM attachment WHERE id = ?1",
            [&image.id],
            |row| row.get(0),
        )
        .expect("孤儿时间");
    assert!(orphaned.is_some(), "失去最后一个引用必须标记孤儿");
}

#[test]
fn library_seeds_presets_imports_and_toggles() {
    let env = TestEnv::new();
    env.create_workspace("libraries", "组件库");

    let libraries = library_service::list(&env.state).expect("组件库列表");
    assert!(
        libraries.len() >= 7,
        "内置预设应被 seed：{:?}",
        libraries.len()
    );
    let shapes = libraries
        .iter()
        .find(|library| library.name == "基础形状")
        .expect("基础形状预设");
    assert!(shapes.enabled, "核心预设默认启用");
    assert!(shapes.item_count > 0);

    let before = library_service::enabled_items(&env.state).expect("启用组件");
    assert!(!before.is_empty(), "启用库必须返回组件");

    let library_dir = env.dir.path().join("libs");
    fs::create_dir_all(&library_dir).expect("组件库目录");
    let path = library_dir.join("custom.excalidrawlib");
    fs::write(
        &path,
        json!({
            "type": "excalidrawlib",
            "version": 1,
            "library": [[
                {"type": "rectangle", "id": "r1", "x": 0, "y": 0, "width": 10, "height": 10}
            ]]
        })
        .to_string(),
    )
    .expect("写入组件库文件");
    let imported = library_service::import(
        &env.state,
        ImportLibraryInput {
            path: path.to_string_lossy().into_owned(),
            name: Some("自定义组件".to_string()),
            author: Some("测试".to_string()),
            license: Some("MIT".to_string()),
            source_url: None,
        },
    )
    .expect("导入组件库");
    assert_eq!(imported.item_count, 1);

    let disabled = library_service::set_enabled(
        &env.state,
        SetLibraryEnabledInput {
            id: shapes.id.clone(),
            enabled: false,
        },
    )
    .expect("停用预设");
    assert!(!disabled.enabled);
    let after = library_service::enabled_items(&env.state).expect("停用后的组件");
    assert!(
        after.len() < before.len(),
        "停用预设后组件数量必须减少：{} -> {}",
        before.len(),
        after.len()
    );

    let preset_delete = library_service::delete(&env.state, &shapes.id).expect_err("预设不可删除");
    assert!(matches!(preset_delete, AppError::Validation(_)));

    let result = library_service::delete(&env.state, &imported.id).expect("删除导入库");
    assert_eq!(result.deleted_items, 1);
    assert!(
        library_service::list(&env.state)
            .expect("删除后的列表")
            .iter()
            .all(|library| library.id != imported.id)
    );
}

// ───────────────────────── 画板导出 / 导入（2026-10-25） ─────────────────────────

#[test]
fn export_knowledge_base_writes_board_bundle_attachments_and_sidecar() {
    let env = TestEnv::new();
    env.create_workspace("ws-board-bundle", "画板导出");
    let kb_id = env.first_kb_id();
    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let image = attachment_service::upload_bytes(
        &context,
        "架构图.png".to_string(),
        "画板".to_string(),
        Some("image/png".to_string()),
        png_bytes(),
    )
    .expect("上传画板图片");
    let file = attachment_service::upload_bytes(
        &context,
        "说明.txt".to_string(),
        "画板".to_string(),
        Some("text/plain".to_string()),
        b"sidecar".to_vec(),
    )
    .expect("上传画板附件");
    attachment_service::upload_bytes(
        &context,
        "孤立.txt".to_string(),
        "loose".to_string(),
        Some("text/plain".to_string()),
        b"orphan".to_vec(),
    )
    .expect("上传未引用附件");

    let board = env.create_node(&kb_id, None, BOARD, "架构画板");
    board_service::save(
        &env.state,
        BoardSaveInput {
            node_id: board.id.clone(),
            base_version: 0,
            elements: json!([
                {
                    "type": "image",
                    "id": "img",
                    "fileId": image.id,
                    "x": 0,
                    "y": 0,
                    "width": 10,
                    "height": 10
                },
                {
                    "type": "rectangle",
                    "id": "card",
                    "x": 20,
                    "y": 0,
                    "width": 10,
                    "height": 10,
                    "customData": {
                        "boardFileCard": true,
                        "objectId": file.id,
                        "name": "说明.txt",
                        "mime": "text/plain",
                        "size": 7
                    }
                }
            ]),
            app_state: json!({"viewBackgroundColor": "#ffffff"}),
        },
    )
    .expect("保存画板");

    let dest = env.dir.path().join("export-boards");
    fs::create_dir_all(&dest).expect("导出目录");
    let result = export_service::export_knowledge_base(
        &env.state,
        ExportKnowledgeBaseInput {
            knowledge_base_id: kb_id.clone(),
            format: ExportFormat::Markdown,
            dest_dir: dest.to_string_lossy().into_owned(),
        },
    )
    .expect("整库导出");

    assert_eq!(result.boards.len(), 1);
    let target = &result.boards[0];
    assert_eq!(target.title, "架构画板");
    assert!(!Path::new(&target.png_path).exists(), "PNG 应由前端写入");
    assert!(!Path::new(&target.svg_path).exists(), "SVG 应由前端写入");

    let raw = fs::read_to_string(&target.excalidraw_path).expect("读取 excalidraw");
    let value: Value = serde_json::from_str(&raw).expect("excalidraw JSON");
    assert_eq!(value["type"], "excalidraw");
    assert_eq!(value["elements"][0]["fileId"], json!(image.id));
    let files_map = value["files"].as_object().expect("files 映射");
    assert!(files_map.contains_key(&image.id), "图片未内嵌");
    assert!(
        files_map[&image.id]["dataURL"]
            .as_str()
            .is_some_and(|url| url.starts_with("data:image/png;base64,"))
    );

    let sidecar_path = Path::new(&target.dir_path).join("attachments.json");
    let sidecar: Value =
        serde_json::from_slice(&fs::read(&sidecar_path).expect("attachments.json")).expect("json");
    assert_eq!(
        sidecar["attachments"].as_array().expect("附件数组").len(),
        2
    );
    let attach_dir = Path::new(&target.dir_path).join("attach");
    assert!(attach_dir.join("架构图.png").is_file());
    assert!(attach_dir.join("说明.txt").is_file());
    assert_eq!(result.attachment_count, 3, "2 个画板附件 + 1 个未引用附件");
    assert!(
        result
            .files
            .iter()
            .any(|file| file.kind == "board" && file.path == target.excalidraw_path)
    );

    let root = PathBuf::from(&result.root_path);
    assert!(
        root.join("_attachments")
            .join("loose")
            .join("孤立.txt")
            .is_file(),
        "未引用附件未导出"
    );
    assert!(
        !root
            .join("_attachments")
            .join("loose")
            .join("架构图.png")
            .exists(),
        "画板图片不应重复进入 _attachments"
    );
    let manifest: Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).expect("manifest"))
            .expect("manifest JSON");
    assert_eq!(
        manifest["boards"][0]["formats"]
            .as_array()
            .expect("formats")
            .len(),
        3
    );
    assert_eq!(manifest["boards"][0]["dir"], json!(target.dir_path));
}

#[test]
fn export_write_file_handles_base64_overwrite_and_paths() {
    use base64::Engine as _;

    let env = TestEnv::new();
    let dir = env.dir.path().join("write-export");
    fs::create_dir_all(&dir).expect("导出目录");
    let path = dir.join("board.png");
    let encode = |value: &[u8]| base64::engine::general_purpose::STANDARD.encode(value);

    let written = export_service::write_export_file(ExportWriteFileInput {
        path: path.to_string_lossy().into_owned(),
        data_base64: encode(b"first"),
        overwrite: false,
    })
    .expect("写入 PNG");
    assert_eq!(written.kind, "board-image");
    assert_eq!(fs::read(&path).expect("读取 PNG"), b"first");

    let duplicate = export_service::write_export_file(ExportWriteFileInput {
        path: path.to_string_lossy().into_owned(),
        data_base64: encode(b"second"),
        overwrite: false,
    })
    .expect_err("未允许覆盖时应失败");
    assert!(matches!(duplicate, AppError::Validation(_)));

    export_service::write_export_file(ExportWriteFileInput {
        path: path.to_string_lossy().into_owned(),
        data_base64: encode(b"second"),
        overwrite: true,
    })
    .expect("覆盖写入");
    assert_eq!(fs::read(&path).expect("读取覆盖后的 PNG"), b"second");

    let relative = export_service::write_export_file(ExportWriteFileInput {
        path: "relative.png".to_string(),
        data_base64: encode(b"x"),
        overwrite: true,
    })
    .expect_err("相对路径必须失败");
    assert!(matches!(relative, AppError::Validation(_)));

    let invalid = export_service::write_export_file(ExportWriteFileInput {
        path: dir.join("bad.png").to_string_lossy().into_owned(),
        data_base64: "!!!".to_string(),
        overwrite: true,
    })
    .expect_err("非法 base64 必须失败");
    assert!(matches!(invalid, AppError::Validation(_)));
}

#[test]
fn import_excalidraw_uploads_embedded_images_to_board() {
    use base64::Engine as _;

    let env = TestEnv::new();
    env.create_workspace("ws-board-import", "画板导入");
    let kb_id = env.first_kb_id();
    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png_bytes())
    );
    let source = env.dir.path().join("外部画板.excalidraw");
    let payload = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "test",
        "elements": [
            {"type": "rectangle", "id": "r1", "x": 0, "y": 0, "width": 10, "height": 10},
            {"type": "image", "id": "i1", "fileId": "file-1", "x": 20, "y": 0, "width": 10, "height": 10}
        ],
        "appState": {"viewBackgroundColor": "#ffffff"},
        "files": {
            "file-1": {"mimeType": "image/png", "dataURL": data_url, "created": 1}
        }
    });
    fs::write(&source, serde_json::to_vec(&payload).expect("序列化")).expect("写入测试文件");

    let result = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            paths: vec![source.to_string_lossy().into_owned()],
            mode: ImportMode::Files,
            preserve_hierarchy: false,
        },
    )
    .expect("导入 Excalidraw");
    assert_eq!(result.imported, 1);
    assert_eq!(result.failed, 0);
    let info = &result.files[0];
    assert_eq!(info.title, "外部画板");
    assert_eq!(info.attachment_count, 1);
    let node_id = info.node_id.clone().expect("画板节点");
    let nodes = node_service::list(&env.state, &kb_id).expect("节点列表");
    let node = nodes
        .iter()
        .find(|node| node.id == node_id)
        .expect("画板节点存在");
    assert_eq!(node.node_type, BOARD);

    let loaded = board_service::load(&env.state, &node_id).expect("加载画板");
    assert_eq!(loaded.files.len(), 1);
    let new_file_id = loaded.files[0].id.clone();
    assert_ne!(new_file_id, "file-1", "fileId 必须改写为 object_id");
    let elements = loaded.elements.as_array().expect("图元数组");
    let image = elements
        .iter()
        .find(|element| element.get("type").and_then(Value::as_str) == Some("image"))
        .expect("图片图元");
    assert_eq!(image["fileId"], json!(new_file_id));
    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let meta = attachment_service::get(&context, &new_file_id).expect("全局对象");
    assert_eq!(meta.mime, "image/png");
}

#[test]
fn import_excalidraw_restores_sidecar_card_attachment_and_rejects_invalid() {
    let env = TestEnv::new();
    env.create_workspace("ws-board-sidecar", "画板附件导入");
    let kb_id = env.first_kb_id();
    let package = env.dir.path().join("board-package");
    fs::create_dir_all(package.join("attach")).expect("画板包目录");
    fs::write(package.join("attach/说明.txt"), b"sidecar").expect("写入附件");
    let payload = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "test",
        "elements": [{
            "type": "rectangle",
            "id": "card",
            "x": 0,
            "y": 0,
            "width": 10,
            "height": 10,
            "customData": {
                "boardFileCard": true,
                "objectId": "legacy-card",
                "name": "说明.txt",
                "mime": "text/plain",
                "size": 7
            }
        }],
        "appState": {},
        "files": {}
    });
    let source = package.join("带附件画板.excalidraw");
    fs::write(&source, serde_json::to_vec(&payload).expect("序列化")).expect("写入画板");
    fs::write(
        package.join("attachments.json"),
        serde_json::to_vec(&json!({
            "type": "starris-board-attachments",
            "version": 1,
            "attachments": [{
                "objectId": "legacy-card",
                "name": "说明.txt",
                "mime": "text/plain",
                "size": 7,
                "file": "attach/说明.txt"
            }]
        }))
        .expect("序列化 sidecar"),
    )
    .expect("写入 sidecar");

    let result = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            paths: vec![source.to_string_lossy().into_owned()],
            mode: ImportMode::Files,
            preserve_hierarchy: false,
        },
    )
    .expect("导入带附件画板");
    assert_eq!(result.imported, 1);
    assert_eq!(result.files[0].attachment_count, 1);
    let node_id = result.files[0].node_id.clone().expect("画板节点");
    let loaded = board_service::load(&env.state, &node_id).expect("加载画板");
    assert!(loaded.missing_object_ids.is_empty(), "附件应恢复");
    let elements = loaded.elements.as_array().expect("图元数组");
    let card = elements
        .iter()
        .find(|element| {
            element
                .get("customData")
                .and_then(|custom| custom.get("boardFileCard"))
                .and_then(Value::as_bool)
                .is_some_and(|value| value)
        })
        .expect("文件卡片");
    let object_id = card["customData"]["objectId"].as_str().expect("objectId");
    assert_ne!(object_id, "legacy-card");
    let context = AttachmentContext::from_state(&env.state).expect("附件上下文");
    let meta = attachment_service::get(&context, object_id).expect("恢复的全局对象");
    assert_eq!(meta.mime, "text/plain");

    let before = node_service::list(&env.state, &kb_id)
        .expect("节点列表")
        .len();
    let invalid = env.dir.path().join("坏画板.excalidraw");
    fs::write(&invalid, br#"{"type":"excalidraw"}"#).expect("写入坏文件");
    let failed = import_service::import_documents(
        &env.state,
        ImportDocumentsInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            paths: vec![invalid.to_string_lossy().into_owned()],
            mode: ImportMode::Files,
            preserve_hierarchy: false,
        },
    )
    .expect("导入坏文件");
    assert_eq!(failed.failed, 1);
    assert_eq!(
        node_service::list(&env.state, &kb_id)
            .expect("节点列表")
            .len(),
        before,
        "无效画板不应留下节点"
    );
}

#[test]
fn mindmap_lifecycle_formats_and_search_roundtrip() {
    let env = TestEnv::new();
    env.create_workspace("mindmap-lifecycle", "思维导图");
    let kb_id = env.first_kb_id();
    let node = env.create_node(&kb_id, None, 7, "产品规划");

    let initial = mindmap_service::load(&env.state, &node.id).expect("加载默认导图");
    assert_eq!(initial.version, 0);
    assert_eq!(initial.content.sheet.root.text, "中心主题");

    let content = MindmapContent {
        schema_version: 2,
        sheet: crate::models::mindmap::MindmapSheet {
            id: initial.content.sheet.id.clone(),
            structure: MindmapStructure::LogicRight,
            theme: MindmapTheme::Warm,
            branch_coloring: Default::default(),
            edge_style: Default::default(),
            background: Default::default(),
            show_numbers: false,
            root: MindmapTopic {
                id: initial.content.sheet.root.id.clone(),
                text: "产品规划".to_string(),
                note: "总目标".to_string(),
                labels: vec![],
                link: String::new(),
                markers: vec![],
                image: None,
                collapsed: false,
                style: None,
                pos: None,
                stickers: Vec::new(),
                children: vec![MindmapTopic {
                    id: "topic-mindmap-child".to_string(),
                    text: "搜索能力".to_string(),
                    note: "FTS trigram".to_string(),
                    labels: vec!["P0".to_string()],
                    link: "https://example.test/search".to_string(),
                    markers: vec!["priority-1".to_string()],
                    image: None,
                    collapsed: true,
                    style: None,
                    pos: None,
                    stickers: Vec::new(),
                    children: vec![MindmapTopic {
                        id: "topic-mindmap-grandchild".to_string(),
                        text: "主题定位".to_string(),
                        note: String::new(),
                        labels: vec![],
                        link: String::new(),
                        markers: vec![],
                        image: None,
                        collapsed: false,
                        style: None,
                        pos: None,
                        stickers: Vec::new(),
                        children: vec![],
                    }],
                }],
            },
        },
        relationships: Vec::new(),
        boundaries: Vec::new(),
        summaries: Vec::new(),
        free_topics: Vec::new(),
    };
    let saved = mindmap_service::save(
        &env.state,
        MindmapSaveInput {
            node_id: node.id.clone(),
            base_version: 0,
            content: content.clone(),
        },
    )
    .expect("保存导图");
    assert_eq!(saved.topic_count, 3);
    assert!(
        mindmap_service::save(
            &env.state,
            MindmapSaveInput {
                node_id: node.id.clone(),
                base_version: 0,
                content,
            },
        )
        .is_err(),
        "旧版本不得覆盖新场景"
    );

    let hits = search_service::search(
        &env.state,
        SearchNodesInput {
            query: "主题定位".to_string(),
            knowledge_base_id: kb_id.clone(),
            limit: 20,
        },
    )
    .expect("搜索导图正文");
    assert!(hits.iter().any(|hit| hit.node_id == node.id));

    let xmind_path = env.dir.path().join("产品规划.xmind");
    mindmap_service::export(
        &env.state,
        &node.id,
        mindmap_format::MindmapFormat::Xmind,
        &xmind_path.to_string_lossy(),
    )
    .expect("导出 XMind");
    let imported = mindmap_format::parse(&xmind_path).expect("回读 XMind");
    assert_eq!(imported.len(), 1);
    let root = &imported[0].content.sheet.root;
    assert_eq!(root.text, "产品规划");
    assert_eq!(root.children[0].text, "搜索能力");
    assert_eq!(root.children[0].note, "FTS trigram");
    assert_eq!(root.children[0].labels, vec!["P0".to_string()]);
    assert!(root.children[0].collapsed);
    assert_eq!(root.children[0].children[0].text, "主题定位");

    let markdown_path = env.dir.path().join("大纲.md");
    fs::write(
        &markdown_path,
        "# 项目\n\n## 目标\n- 导图\n  - 导入\n\n说明文字\n",
    )
    .expect("写 Markdown");
    let imported = mindmap_import_service::import(
        &env.state,
        &kb_id,
        None,
        &[markdown_path.to_string_lossy().into_owned()],
    )
    .expect("导入 Markdown");
    assert_eq!(imported.imported, 1);
    let markdown_node = imported.files[0].node_id.clone().expect("Markdown 节点");
    let markdown = mindmap_service::load(&env.state, &markdown_node).expect("加载 Markdown 导图");
    assert_eq!(markdown.content.sheet.root.text, "项目");
    assert_eq!(markdown.content.sheet.root.children[0].text, "目标");

    let deleted = node_service::delete(&env.state, &node.id).expect("移入回收站");
    assert_eq!(deleted.deleted_count, 1);
    assert!(mindmap_service::load(&env.state, &node.id).is_err());
    node_service::restore(&env.state, &node.id).expect("恢复导图");
    let restored = mindmap_service::load(&env.state, &node.id).expect("恢复后加载");
    assert_eq!(restored.topic_count, 3);
}
/// 需求 §14 的性能预算：1000 主题的保存、XMind 导出与导入必须有实测记录。
/// 断言用宽松上界以免 debug 构建抖动；实测毫秒数打到 stdout，由单元测试文档归档。
#[test]
fn mindmap_thousand_topic_save_export_import_budget() {
    const TOTAL: usize = 1_000;

    fn build_topic(id: String, text: String) -> crate::models::mindmap::MindmapTopic {
        crate::models::mindmap::MindmapTopic {
            id,
            text,
            note: String::new(),
            labels: vec![],
            link: String::new(),
            markers: vec![],
            image: None,
            collapsed: false,
            style: None,
            pos: None,
            stickers: Vec::new(),
            children: vec![],
        }
    }

    // 完全三叉树：节点 i 的孩子是 3i+1..=3i+3，深度约 log3(1000) ≈ 7 层。
    fn assemble(index: usize, id: String) -> crate::models::mindmap::MindmapTopic {
        let text = if index == 0 {
            "性能基准".to_string()
        } else {
            format!("主题 {index:04} 要点补充说明")
        };
        let mut topic = build_topic(id, text);
        for child_index in [3 * index + 1, 3 * index + 2, 3 * index + 3] {
            if child_index < TOTAL {
                topic
                    .children
                    .push(assemble(child_index, format!("topic-{child_index:05}")));
            }
        }
        topic
    }

    fn count_topics(topic: &crate::models::mindmap::MindmapTopic) -> usize {
        1 + topic.children.iter().map(count_topics).sum::<usize>()
    }

    let content = crate::models::mindmap::MindmapContent {
        schema_version: 2,
        sheet: crate::models::mindmap::MindmapSheet {
            id: "sheet-perf".to_string(),
            structure: MindmapStructure::Balanced,
            theme: MindmapTheme::Auto,
            branch_coloring: Default::default(),
            edge_style: Default::default(),
            background: Default::default(),
            show_numbers: false,
            root: assemble(0, "topic-root".to_string()),
        },
        relationships: Vec::new(),
        boundaries: Vec::new(),
        summaries: Vec::new(),
        free_topics: Vec::new(),
    };
    assert_eq!(count_topics(&content.sheet.root), TOTAL, "基准树规模");

    let env = TestEnv::new();
    env.create_workspace("mindmap-perf", "思维导图");
    let node = env.create_node(&env.first_kb_id(), None, 7, "性能基准");

    let start = Instant::now();
    let saved = mindmap_service::save(
        &env.state,
        MindmapSaveInput {
            node_id: node.id.clone(),
            base_version: 0,
            content,
        },
    )
    .expect("保存 1000 主题");
    let save_ms = start.elapsed().as_millis();
    assert_eq!(saved.topic_count, TOTAL as i64);

    let xmind_path = env.dir.path().join("性能基准.xmind");
    let start = Instant::now();
    mindmap_service::export(
        &env.state,
        &node.id,
        mindmap_format::MindmapFormat::Xmind,
        &xmind_path.to_string_lossy(),
    )
    .expect("导出 1000 主题 XMind");
    let export_ms = start.elapsed().as_millis();

    let start = Instant::now();
    let parsed = mindmap_format::parse(&xmind_path).expect("回读 1000 主题 XMind");
    let parse_ms = start.elapsed().as_millis();
    assert_eq!(parsed.len(), 1);
    assert_eq!(count_topics(&parsed[0].content.sheet.root), TOTAL);

    let start = Instant::now();
    let imported = mindmap_import_service::import(
        &env.state,
        &env.first_kb_id(),
        None,
        &[xmind_path.to_string_lossy().into_owned()],
    )
    .expect("导入 1000 主题 XMind");
    let import_ms = start.elapsed().as_millis();
    assert_eq!(imported.imported, 1);

    println!(
        "MM-PERF save={save_ms}ms export={export_ms}ms parse={parse_ms}ms import={import_ms}ms topics={TOTAL}"
    );
    assert!(save_ms < 5_000, "保存耗时 {save_ms}ms 超出 debug 上界");
    assert!(export_ms < 5_000, "导出耗时 {export_ms}ms 超出 debug 上界");
    assert!(parse_ms < 5_000, "解析耗时 {parse_ms}ms 超出 debug 上界");
    assert!(import_ms < 10_000, "导入耗时 {import_ms}ms 超出 debug 上界");
}

/// AI 协作：权限矩阵、待审区审批/拒绝、段落级编辑与并发冲突。
#[test]
fn ai_permission_matrix_inbox_and_paragraph_edits() {
    let env = TestEnv::new();
    env.create_workspace("ai-collab", "AI 协作");
    let kb_id = env.first_kb_id();

    let initial = ai_service::permissions(&env.state).expect("默认权限");
    assert_eq!(initial.doc, "review", "默认写权限应为待审");

    // review：低风险写工具进入待审区，未落库
    let created = ai_service::execute(
        &env.state,
        "doc_create",
        &json!({
            "knowledgeBaseId": kb_id,
            "title": "AI 文档",
            "markdown": "# 标题\n\n第一段",
            "summary": "agent 初始化文档"
        }),
    )
    .expect("doc_create");
    assert_eq!(created.status, "pending_review");
    let inbox_id = created.inbox_id.clone().expect("应返回待审 id");
    assert!(
        node_service::list(&env.state, &kb_id)
            .expect("节点列表")
            .iter()
            .all(|node| node.title != "AI 文档"),
        "待审期间不得落库"
    );

    // 审批通过 → 文档创建成功
    ai_service::approve(&env.state, &inbox_id).expect("审批通过");
    let node = node_service::list(&env.state, &kb_id)
        .expect("节点列表")
        .into_iter()
        .find(|item| item.title == "AI 文档")
        .expect("文档应存在");

    let read = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": node.id }))
        .expect("doc_read")
        .data
        .expect("读取数据");
    let blocks = read
        .get("blocks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    assert_eq!(blocks.len(), 2, "标题 + 段落");
    let first_block_id = blocks[0]
        .get("blockId")
        .and_then(Value::as_str)
        .expect("blockId")
        .to_string();
    let version = read
        .get("version")
        .and_then(Value::as_i64)
        .expect("version");

    // review：更新段落 → 待审；拒绝后内容不变
    let update = ai_service::execute(
        &env.state,
        "doc_update_block",
        &json!({
            "nodeId": node.id,
            "blockId": first_block_id,
            "text": "被拒绝的修改",
            "summary": "尝试改标题",
            "expectedVersion": version
        }),
    )
    .expect("doc_update_block");
    let reject_id = update.inbox_id.expect("待审 id");
    ai_service::reject(&env.state, &reject_id).expect("拒绝");
    let after_reject = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": node.id }))
        .expect("doc_read")
        .data
        .expect("读取数据");
    let texts = after_reject
        .get("blocks")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    item.get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    assert!(texts.contains(&"标题".to_string()), "拒绝后保持原样");

    // read-only：写工具直接拒绝
    ai_service::set_permissions(
        &env.state,
        crate::repositories::ai_repository::AiPermissions {
            doc: "read-only".to_string(),
            board: "review".to_string(),
            mindmap: "review".to_string(),
        },
    )
    .expect("设置只读");
    let denied = ai_service::execute(
        &env.state,
        "doc_append_blocks",
        &json!({ "nodeId": node.id, "blocks": [{ "text": "追加" }] }),
    )
    .expect("只读执行");
    assert_eq!(denied.status, "denied");

    // editable：中风险直写；高风险仍进待审
    ai_service::set_permissions(
        &env.state,
        crate::repositories::ai_repository::AiPermissions {
            doc: "editable".to_string(),
            board: "review".to_string(),
            mindmap: "review".to_string(),
        },
    )
    .expect("设置可编辑");
    let direct = ai_service::execute(
        &env.state,
        "doc_append_blocks",
        &json!({ "nodeId": node.id, "blocks": [{ "type": "paragraph", "text": "直写段落" }], "summary": "追加" }),
    )
    .expect("直写");
    assert_eq!(direct.status, "ok");
    let risky = ai_service::execute(
        &env.state,
        "doc_replace_range",
        &json!({ "nodeId": node.id, "start": 0, "end": 1, "blocks": [], "summary": "清空标题" }),
    )
    .expect("高风险");
    assert_eq!(risky.status, "pending_review", "高风险始终待审");

    // 并发冲突：review 模式下用旧 expectedVersion 入队，审批时版本已变化 → 失败并记录原因
    ai_service::set_permissions(
        &env.state,
        crate::repositories::ai_repository::AiPermissions {
            doc: "review".to_string(),
            board: "review".to_string(),
            mindmap: "review".to_string(),
        },
    )
    .expect("回到待审模式");
    let stale_id = risky.inbox_id.expect("待审 id");
    ai_service::approve(&env.state, &stale_id).expect("无版本约束时可执行");
    let current = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": node.id }))
        .expect("doc_read")
        .data
        .expect("读取数据");
    let next_version = current
        .get("version")
        .and_then(Value::as_i64)
        .expect("version");
    let conflicting = ai_service::execute(
        &env.state,
        "doc_update_block",
        &json!({
            "nodeId": node.id,
            "blockId": first_block_id,
            "text": "并发修改",
            "expectedVersion": next_version - 1
        }),
    )
    .expect("入待审");
    let conflict_id = conflicting.inbox_id.expect("待审 id");
    assert!(
        ai_service::approve(&env.state, &conflict_id).is_err(),
        "版本冲突应审批失败"
    );
    let failed = ai_service::inbox(&env.state, Some("failed")).expect("失败列表");
    assert!(failed.iter().any(|row| row.id == conflict_id));

    let audit_rows = ai_service::audit(&env.state).expect("审计");
    assert!(audit_rows.iter().any(|row| row.outcome == "approved"));
    assert!(audit_rows.iter().any(|row| row.outcome == "rejected"));
    assert!(audit_rows.iter().any(|row| row.outcome == "denied"));
    assert!(audit_rows.iter().any(|row| row.outcome == "direct"));
}

/// 同一条待审项只能被审批一次：第二次必须冲突，且不产生重复写入。
#[test]
fn ai_inbox_approve_is_single_shot() {
    let env = TestEnv::new();
    env.create_workspace("ai-approve", "AI 审批幂等");
    let kb_id = env.first_kb_id();
    let created = ai_service::execute(
        &env.state,
        "doc_create",
        &json!({
            "knowledgeBaseId": kb_id,
            "title": "唯一文档",
            "markdown": "内容",
            "summary": "建立唯一文档"
        }),
    )
    .expect("doc_create");
    let inbox_id = created.inbox_id.expect("待审 id");
    ai_service::approve(&env.state, &inbox_id).expect("首次审批");
    let second = ai_service::approve(&env.state, &inbox_id);
    assert!(second.is_err(), "重复审批必须失败");
    let nodes = node_service::list(&env.state, &kb_id).expect("节点列表");
    assert_eq!(
        nodes.iter().filter(|node| node.title == "唯一文档").count(),
        1,
        "重复审批不得产生第二份文档"
    );
}

/// 节点级工具按目标节点类型选择作用域，而不是工具声明里写死的那个。
#[test]
fn ai_node_tools_follow_target_node_scope() {
    let env = TestEnv::new();
    env.create_workspace("ai-scope", "AI 作用域跟随");
    let kb_id = env.first_kb_id();

    let board = node_service::create(
        &env.state,
        CreateNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            node_type: 3,
            title: "作用域画板".to_string(),
        },
    )
    .expect("画板节点");
    let mindmap = node_service::create(
        &env.state,
        CreateNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            node_type: 7,
            title: "作用域导图".to_string(),
        },
    )
    .expect("导图节点");
    let doc = node_service::create(
        &env.state,
        CreateNodeInput {
            knowledge_base_id: kb_id.clone(),
            parent_id: None,
            node_type: 2,
            title: "作用域文档".to_string(),
        },
    )
    .expect("文档节点");

    ai_service::set_permissions(
        &env.state,
        crate::repositories::ai_repository::AiPermissions {
            doc: "editable".to_string(),
            board: "review".to_string(),
            mindmap: "read-only".to_string(),
        },
    )
    .expect("写权限");

    // node_trash 声明在导图作用域：目标是画板时必须走画板作用域（review → 待审）。
    let trash = ai_service::execute(
        &env.state,
        "node_trash",
        &json!({ "nodeId": board.id, "summary": "清理画板" }),
    )
    .expect("node_trash");
    assert_eq!(trash.status, "pending_review", "画板作用域为 review");

    // node_rename 声明在文档作用域：目标是导图时必须走导图只读作用域（拒绝）。
    let rename = ai_service::execute(
        &env.state,
        "node_rename",
        &json!({ "nodeId": mindmap.id, "title": "改名", "summary": "改名" }),
    )
    .expect("node_rename");
    assert_eq!(rename.status, "denied", "导图作用域只读");

    // 目标是文档时仍按文档作用域直接执行。
    let ok = ai_service::execute(
        &env.state,
        "node_rename",
        &json!({ "nodeId": doc.id, "title": "文档改名", "summary": "改名" }),
    )
    .expect("node_rename");
    assert_eq!(ok.status, "ok", "文档作用域可编辑");
}

/// AI 扩展工具：段落插入/删除、画板元素删除、节点重命名/移动/新建文件夹。
#[test]
fn ai_extended_tools_cover_paragraph_and_board_edits() {
    let env = TestEnv::new();
    env.create_workspace("ai-extended", "AI 扩展工具");
    let kb_id = env.first_kb_id();
    ai_service::set_permissions(
        &env.state,
        crate::repositories::ai_repository::AiPermissions {
            doc: "editable".to_string(),
            board: "editable".to_string(),
            mindmap: "editable".to_string(),
        },
    )
    .expect("设置可编辑");

    // 文档：创建后可直插段落
    let created = ai_service::execute(
        &env.state,
        "doc_create",
        &json!({ "knowledgeBaseId": kb_id, "title": "扩展文档", "markdown": "# 标题\n\n第一段" }),
    )
    .expect("doc_create");
    assert_eq!(created.status, "ok");
    let doc_id = created
        .data
        .as_ref()
        .and_then(|value| value.get("nodeId"))
        .and_then(Value::as_str)
        .expect("nodeId")
        .to_string();
    let read = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": doc_id }))
        .expect("doc_read")
        .data
        .expect("数据");
    let heading_id = read
        .get("blocks")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("blockId"))
        .and_then(Value::as_str)
        .expect("首个 blockId")
        .to_string();
    let inserted = ai_service::execute(
        &env.state,
        "doc_insert_after_block",
        &json!({
            "nodeId": doc_id,
            "blockId": heading_id,
            "blocks": [{ "type": "paragraph", "text": "插入段" }],
            "summary": "补充说明"
        }),
    )
    .expect("插入段落");
    assert_eq!(inserted.status, "ok");
    let texts = |value: &Value| -> Vec<String> {
        value
            .get("blocks")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| {
                        item.get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string()
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let after_insert = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": doc_id }))
        .expect("doc_read")
        .data
        .expect("数据");
    assert_eq!(texts(&after_insert), vec!["标题", "插入段", "第一段"]);

    // 删除段落：高风险 → 待审 → 通过后消失
    let deleted = ai_service::execute(
        &env.state,
        "doc_delete_block",
        &json!({ "nodeId": doc_id, "blockId": heading_id, "summary": "删除标题" }),
    )
    .expect("删除段落");
    assert_eq!(deleted.status, "pending_review");
    ai_service::approve(&env.state, &deleted.inbox_id.expect("待审 id")).expect("审批");
    let after_delete = ai_service::execute(&env.state, "doc_read", &json!({ "nodeId": doc_id }))
        .expect("doc_read")
        .data
        .expect("数据");
    assert_eq!(texts(&after_delete), vec!["插入段", "第一段"]);

    // 画板：追加元素 → 删除元素（高风险走待审）
    let board = env.create_node(&kb_id, None, 3, "AI 画板");
    let added = ai_service::execute(
        &env.state,
        "board_add_elements",
        &json!({
            "nodeId": board.id,
            "elements": [{ "type": "rectangle", "x": 10, "y": 20, "width": 120, "height": 60 }]
        }),
    )
    .expect("添加元素");
    assert_eq!(added.status, "ok");
    let board_read = ai_service::execute(&env.state, "board_read", &json!({ "nodeId": board.id }))
        .expect("board_read")
        .data
        .expect("数据");
    let element_id = board_read
        .get("elements")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("id"))
        .and_then(Value::as_str)
        .expect("元素 id")
        .to_string();
    let removed = ai_service::execute(
        &env.state,
        "board_delete_elements",
        &json!({ "nodeId": board.id, "elementIds": [element_id], "summary": "清理画板" }),
    )
    .expect("删除元素");
    assert_eq!(removed.status, "pending_review");
    ai_service::approve(&env.state, &removed.inbox_id.expect("待审 id")).expect("审批");
    let board_after = ai_service::execute(&env.state, "board_read", &json!({ "nodeId": board.id }))
        .expect("board_read")
        .data
        .expect("数据");
    assert_eq!(
        board_after
            .get("elements")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
        0
    );

    // 节点：新建文件夹 + 重命名 + 移动
    let folder = ai_service::execute(
        &env.state,
        "node_create_folder",
        &json!({ "knowledgeBaseId": kb_id, "title": "AI 文件夹" }),
    )
    .expect("新建文件夹");
    assert_eq!(folder.status, "ok");
    let folder_id = folder
        .data
        .as_ref()
        .and_then(|value| value.get("nodeId"))
        .and_then(Value::as_str)
        .expect("folderId")
        .to_string();
    let renamed = ai_service::execute(
        &env.state,
        "node_rename",
        &json!({ "nodeId": doc_id, "title": "扩展文档·改名" }),
    )
    .expect("重命名");
    assert_eq!(renamed.status, "ok");
    let moved = ai_service::execute(
        &env.state,
        "node_move",
        &json!({ "nodeId": doc_id, "parentId": folder_id, "index": 0 }),
    )
    .expect("移动节点");
    assert_eq!(moved.status, "ok");
    let nodes = node_service::list(&env.state, &kb_id).expect("节点列表");
    assert!(nodes.iter().any(|node| node.title == "扩展文档·改名"));
}

/// 全新工作区：一次性初始化必须建齐所有历史迁移产物（证明自愈不承担"首次初始化"职责）。
#[test]
fn fresh_workspace_schema_is_complete_without_repair() {
    let env = TestEnv::new();
    env.create_workspace("fresh-schema", "全新库");
    let guard = env.state.workspace().expect("工作区");
    let connection = &guard.as_ref().expect("会话").connection;
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN
             ('node','attachment','node_attachment','workspace_meta','search_index','doc_history',
              'mindmap_scene','mindmap_viewport','ai_inbox','ai_audit')",
            [],
            |row| row.get(0),
        )
        .expect("表统计");
    assert_eq!(count, 10, "全新库应一次建齐全部表：{:?}", count);
    let columns: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('attachment') WHERE name IN ('scope','expires_at','orphaned_at')",
            [],
            |row| row.get(0),
        )
        .expect("列统计");
    assert_eq!(columns, 3, "attachment 生命周期列必须由初始化建立");
}
