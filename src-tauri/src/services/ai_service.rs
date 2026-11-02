//! AI 协作服务：MCP 工具的执行、权限判定、待审区与段落级文档/画板操作。
//!
//! 权限模型：每作用域 read-only / review / editable；高风险写操作（区间替换、进回收站）
//! 即使 editable 也强制进入待审区，由人在桌面端确认后才真正落库。

use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{Value, json};

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::board::BoardSaveInput;
use crate::models::search::SearchNodesInput;
use crate::models::{CreateNodeInput, SaveDocumentInput};
use crate::repositories::ai_repository::{self, AiInboxRow, AiPermissions};
use crate::services::{
    ai_review, board_service, document_service, knowledge_base_service, mindmap_service,
    node_service, search_service,
};
use crate::state::AppState;
use crate::utils::{new_id, now_ms};

/// 工具风险等级。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiRisk {
    Low,
    Medium,
    High,
}

impl AiRisk {
    pub fn as_str(self) -> &'static str {
        match self {
            AiRisk::Low => "low",
            AiRisk::Medium => "medium",
            AiRisk::High => "high",
        }
    }
}

/// 工具作用域。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiScope {
    Doc,
    Board,
    Mindmap,
    None,
}

/// 工具定义：名称、说明、作用域与风险。
pub struct AiTool {
    pub name: &'static str,
    pub description: &'static str,
    pub scope: AiScope,
    pub risk: Option<AiRisk>,
    pub input_schema: fn() -> Value,
}

fn empty_schema() -> Value {
    json!({"type": "object", "properties": {}})
}

fn node_arg(properties: Value) -> Value {
    node_arg_required(properties, &[])
}

/// 节点级写入 schema：nodeId 必填，附带 summary/expectedVersion；required 追加调用方列出的键。
fn node_arg_required(properties: Value, required: &[&str]) -> Value {
    let mut map = properties.as_object().cloned().unwrap_or_default();
    map.insert(
        "nodeId".to_string(),
        json!({"type": "string", "description": "目标节点 id"}),
    );
    map.insert(
        "summary".to_string(),
        json!({"type": "string", "description": "这次写入的动机摘要，会出现在待审区与审计日志"}),
    );
    map.insert(
        "expectedVersion".to_string(),
        json!({"type": "integer", "description": "可选的乐观并发版本"}),
    );
    let mut required_names = vec!["nodeId"];
    required_names.extend_from_slice(required);
    json!({"type": "object", "properties": map, "required": required_names})
}

/// 段落规格（写入类工具共用）。
fn blocks_property() -> Value {
    json!({
        "type": "array",
        "description": "段落数组",
        "items": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "description": "paragraph / heading / bulletListItem / numberedListItem / checkListItem / codeBlock"},
                "text": {"type": "string"},
                "level": {"type": "integer", "description": "标题层级 1-3，仅 heading 使用"}
            },
            "required": ["type", "text"]
        }
    })
}

fn kb_search_schema() -> Value {
    json!({"type": "object", "properties": {
        "knowledgeBaseId": {"type": "string", "description": "知识库 id"},
        "query": {"type": "string", "description": "标题与正文关键词"},
        "limit": {"type": "integer", "description": "返回条数上限，默认 20"}
    }, "required": ["knowledgeBaseId"]})
}

fn node_tree_schema() -> Value {
    json!({"type": "object", "properties": {
        "knowledgeBaseId": {"type": "string", "description": "知识库 id"}
    }, "required": ["knowledgeBaseId"]})
}

fn node_read_schema() -> Value {
    json!({"type": "object", "properties": {
        "nodeId": {"type": "string", "description": "目标节点 id"}
    }, "required": ["nodeId"]})
}

fn inbox_list_schema() -> Value {
    json!({"type": "object", "properties": {
        "status": {"type": "string", "enum": ["pending", "approved", "rejected", "failed"], "description": "按状态过滤；不传返回最近全部"}
    }})
}

fn inbox_get_schema() -> Value {
    json!({"type": "object", "properties": {
        "inboxId": {"type": "string", "description": "待审项 id（待审返回里的 inboxId）"}
    }, "required": ["inboxId"]})
}

fn doc_create_schema() -> Value {
    json!({"type": "object", "properties": {
        "knowledgeBaseId": {"type": "string", "description": "知识库 id"},
        "title": {"type": "string", "description": "文档标题"},
        "markdown": {"type": "string", "description": "初始 Markdown 正文"},
        "parentId": {"type": ["string", "null"], "description": "父文件夹 id；根级不传"},
        "summary": {"type": "string", "description": "这次写入的动机摘要"},
        "expectedVersion": {"type": "integer", "description": "可选的乐观并发版本"}
    }, "required": ["knowledgeBaseId", "title"]})
}

fn node_create_folder_schema() -> Value {
    json!({"type": "object", "properties": {
        "knowledgeBaseId": {"type": "string", "description": "知识库 id"},
        "title": {"type": "string", "description": "文件夹名称"},
        "parentId": {"type": ["string", "null"], "description": "父文件夹 id；根级不传"},
        "summary": {"type": "string", "description": "这次写入的动机摘要"},
        "expectedVersion": {"type": "integer", "description": "可选的乐观并发版本"}
    }, "required": ["knowledgeBaseId", "title"]})
}

fn doc_append_blocks_schema() -> Value {
    node_arg_required(json!({"blocks": blocks_property()}), &["blocks"])
}

fn doc_update_block_schema() -> Value {
    node_arg_required(
        json!({
            "blockId": {"type": "string", "description": "目标段落 id（doc_read 返回）"},
            "text": {"type": "string", "description": "新的段落文本"}
        }),
        &["blockId", "text"],
    )
}

fn doc_replace_range_schema() -> Value {
    node_arg_required(
        json!({
            "start": {"type": "integer", "description": "起始下标（含）"},
            "end": {"type": "integer", "description": "结束下标（不含）；必填，缺省不再当作 0 静默不删"},
            "blocks": blocks_property()
        }),
        &["blocks", "end"],
    )
}

fn doc_insert_after_block_schema() -> Value {
    node_arg_required(
        json!({
            "blockId": {"type": "string", "description": "在该段落之后插入"},
            "blocks": blocks_property()
        }),
        &["blockId", "blocks"],
    )
}

fn doc_delete_block_schema() -> Value {
    node_arg_required(
        json!({"blockId": {"type": "string", "description": "要删除的段落 id（连同子块）"}}),
        &["blockId"],
    )
}

fn board_add_elements_schema() -> Value {
    node_arg_required(
        json!({
            "elements": {
                "type": "array",
                "description": "要追加的画板元素",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "description": "rectangle / text / arrow"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "width": {"type": "number"},
                        "height": {"type": "number"},
                        "text": {"type": "string"},
                        "strokeColor": {"type": "string"},
                        "backgroundColor": {"type": "string"}
                    },
                    "required": ["type", "x", "y"]
                }
            }
        }),
        &["elements"],
    )
}

fn board_update_element_schema() -> Value {
    node_arg_required(
        json!({
            "elementId": {"type": "string", "description": "画板元素 id"},
            "patch": {
                "type": "object",
                "description": "要更新的字段",
                "properties": {
                    "text": {"type": "string"},
                    "strokeColor": {"type": "string"},
                    "backgroundColor": {"type": "string"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "width": {"type": "number"},
                    "height": {"type": "number"}
                }
            }
        }),
        &["elementId", "patch"],
    )
}

fn board_delete_elements_schema() -> Value {
    node_arg_required(
        json!({
            "elementIds": {"type": "array", "items": {"type": "string"}, "description": "要删除的元素 id 列表"}
        }),
        &["elementIds"],
    )
}

fn node_rename_schema() -> Value {
    node_arg_required(
        json!({"title": {"type": "string", "description": "新的节点标题"}}),
        &["title"],
    )
}

fn node_move_schema() -> Value {
    node_arg_required(
        json!({
            "parentId": {"type": ["string", "null"], "description": "新父文件夹 id；根级传 null"},
            "index": {"type": "integer", "description": "在新同级中的序号，默认 0"}
        }),
        &[],
    )
}

fn node_trash_schema() -> Value {
    node_arg(json!({}))
}

/// v1 工具清单。
pub fn tools() -> Vec<AiTool> {
    vec![
        AiTool {
            name: "kb_list",
            description: "列出知识库与根级节点",
            scope: AiScope::None,
            risk: None,
            input_schema: empty_schema,
        },
        AiTool {
            name: "kb_search",
            description: "按标题与正文检索节点",
            scope: AiScope::None,
            risk: None,
            input_schema: kb_search_schema,
        },
        AiTool {
            name: "node_tree",
            description: "读取指定父节点的子树",
            scope: AiScope::None,
            risk: None,
            input_schema: node_tree_schema,
        },
        AiTool {
            name: "doc_read",
            description: "段落级读取文档：块 id、类型、文本与版本",
            scope: AiScope::None,
            risk: None,
            input_schema: node_read_schema,
        },
        AiTool {
            name: "board_read",
            description: "读取画板元素列表",
            scope: AiScope::None,
            risk: None,
            input_schema: node_read_schema,
        },
        AiTool {
            name: "mindmap_read",
            description: "读取思维导图树 JSON",
            scope: AiScope::None,
            risk: None,
            input_schema: node_read_schema,
        },
        AiTool {
            name: "inbox_list",
            description: "查询待审项（agent 轮询审批结果）",
            scope: AiScope::None,
            risk: None,
            input_schema: inbox_list_schema,
        },
        AiTool {
            name: "inbox_get",
            description: "按 id 查询待审项状态",
            scope: AiScope::None,
            risk: None,
            input_schema: inbox_get_schema,
        },
        AiTool {
            name: "doc_create",
            description: "在知识库中新建文档并写入初始段落",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Low),
            input_schema: doc_create_schema,
        },
        AiTool {
            name: "doc_append_blocks",
            description: "在文档末尾追加段落（块级）",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Low),
            input_schema: doc_append_blocks_schema,
        },
        AiTool {
            name: "doc_update_block",
            description: "按 blockId 替换单个段落文本",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Medium),
            input_schema: doc_update_block_schema,
        },
        AiTool {
            name: "doc_replace_range",
            description: "按顶层段落区间替换内容（可能删除内容）",
            scope: AiScope::Doc,
            risk: Some(AiRisk::High),
            input_schema: doc_replace_range_schema,
        },
        AiTool {
            name: "board_add_elements",
            description: "向画板追加矩形/文本/箭头元素",
            scope: AiScope::Board,
            risk: Some(AiRisk::Low),
            input_schema: board_add_elements_schema,
        },
        AiTool {
            name: "board_update_element",
            description: "按元素 id 更新文本/颜色/位置/尺寸",
            scope: AiScope::Board,
            risk: Some(AiRisk::Medium),
            input_schema: board_update_element_schema,
        },
        AiTool {
            name: "node_trash",
            description: "把节点移入回收站（可恢复）",
            scope: AiScope::Mindmap,
            risk: Some(AiRisk::High),
            input_schema: node_trash_schema,
        },
        AiTool {
            name: "doc_insert_after_block",
            description: "在指定段落之后插入新段落",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Medium),
            input_schema: doc_insert_after_block_schema,
        },
        AiTool {
            name: "doc_delete_block",
            description: "删除指定段落及其子块",
            scope: AiScope::Doc,
            risk: Some(AiRisk::High),
            input_schema: doc_delete_block_schema,
        },
        AiTool {
            name: "board_delete_elements",
            description: "按 id 删除画板元素",
            scope: AiScope::Board,
            risk: Some(AiRisk::High),
            input_schema: board_delete_elements_schema,
        },
        AiTool {
            name: "node_rename",
            description: "重命名节点标题（含文档/画板/文件夹）",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Medium),
            input_schema: node_rename_schema,
        },
        AiTool {
            name: "node_move",
            description: "把节点移动到新父级与位置",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Medium),
            input_schema: node_move_schema,
        },
        AiTool {
            name: "node_create_folder",
            description: "在知识库中新建文件夹",
            scope: AiScope::Doc,
            risk: Some(AiRisk::Low),
            input_schema: node_create_folder_schema,
        },
    ]
}

/// 工具查找。
pub fn find_tool(name: &str) -> Option<AiTool> {
    tools().into_iter().find(|tool| tool.name == name)
}

/// 权限判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Deny,
    Direct,
    Enqueue,
}

/// 依据作用域模式与风险给出判定。
pub fn decide(mode: &str, risk: AiRisk) -> Decision {
    match mode {
        "read-only" => Decision::Deny,
        "editable" => {
            if risk == AiRisk::High {
                Decision::Enqueue
            } else {
                Decision::Direct
            }
        }
        _ => Decision::Enqueue,
    }
}

/// 节点级工具按目标的实际类型选作用域；目标缺失或未知时退回工具声明。
///
/// 节点类型：1 文件夹 / 2 文档 / 3 画板 / 6 附件 / 7 思维导图。
/// 只有画板与思维导图有自己的作用域；其余（文件夹、文档、附件等树结构）跟随文档作用域。
fn resolve_scope(state: &AppState, tool: &AiTool, args: &Value) -> AppResult<AiScope> {
    if !tool.name.starts_with("node_") {
        return Ok(tool.scope);
    }
    let Some(node_id) = args.get("nodeId").and_then(Value::as_str) else {
        return Ok(tool.scope);
    };
    let guard = state.workspace()?;
    let Some(session) = guard.as_ref() else {
        return Ok(tool.scope);
    };
    let node_type: Option<i64> = session
        .connection
        .query_row(
            "SELECT type FROM node WHERE id = ?1 AND deleted_at IS NULL",
            [node_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(match node_type {
        Some(3) => AiScope::Board,
        Some(7) => AiScope::Mindmap,
        _ => AiScope::Doc,
    })
}

/// 读取权限配置。
pub fn permissions(state: &AppState) -> AppResult<AiPermissions> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    Ok(ai_repository::get_permissions(&session.connection)?)
}

/// 写入权限配置（只接受三种模式）。
pub fn set_permissions(state: &AppState, next: AiPermissions) -> AppResult<AiPermissions> {
    for mode in [&next.doc, &next.board, &next.mindmap] {
        if !matches!(mode.as_str(), "read-only" | "review" | "editable") {
            return Err(AppError::validation("AI 权限模式无效"));
        }
    }
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    ai_repository::set_permissions(&session.connection, &next)?;
    Ok(next)
}

/// 待审列表。
pub fn inbox(state: &AppState, status: Option<&str>) -> AppResult<Vec<AiInboxRow>> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    Ok(ai_repository::list_inbox(&session.connection, status, 100)?)
}

/// 审计列表。
pub fn audit(state: &AppState) -> AppResult<Vec<ai_repository::AiAuditRow>> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    Ok(ai_repository::list_audit(&session.connection, 100)?)
}

/// 工具执行结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExecution {
    /// ok / pending_review / denied
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbox_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// 统一入口：读取直接执行；写入按权限直写或入待审区。
pub fn execute(state: &AppState, tool_name: &str, args: &Value) -> AppResult<AiExecution> {
    let tool = find_tool(tool_name).ok_or_else(|| AppError::validation("未知的 AI 工具"))?;
    let Some(risk) = tool.risk else {
        let data = run_read(state, tool_name, args)?;
        return Ok(AiExecution {
            status: "ok",
            data: Some(data),
            inbox_id: None,
            message: None,
        });
    };
    let settings = permissions(state)?;
    let scope = resolve_scope(state, &tool, args)?;
    let mode = match scope {
        AiScope::Doc => settings.doc.as_str(),
        AiScope::Board => settings.board.as_str(),
        AiScope::Mindmap => settings.mindmap.as_str(),
        AiScope::None => "review",
    };
    let risk_mode = match mode {
        "read-only" => "read-only",
        "editable" => "editable",
        _ => "review",
    };
    match decide(risk_mode, risk) {
        Decision::Deny => {
            record_audit(state, tool_name, args, risk, "denied")?;
            Ok(AiExecution {
                status: "denied",
                data: None,
                inbox_id: None,
                message: Some("PERMISSION_DENIED：当前作用域为只读".to_string()),
            })
        }
        Decision::Enqueue => {
            let inbox_id = enqueue(state, tool_name, args, risk)?;
            // 入队也要留痕：否则最终被拒绝的写入在审计里完全看不见。
            // 取值受 ai_audit.outcome 的 CHECK 约束：入队是 'inbox'，不是自造的词。
            record_audit(state, tool_name, args, risk, "inbox")?;
            // 主界面弹出前后对比确认窗；渲染失败不影响待审项本身（设置页仍可处理）。
            match ai_review::preview(state, &inbox_id, tool_name, args, risk.as_str()) {
                Ok(preview) => ai_review::emit(&preview),
                Err(error) => logging::error("ai", &format!("生成待审对比失败: {error}")),
            }
            Ok(AiExecution {
                status: "pending_review",
                data: None,
                inbox_id: Some(inbox_id),
                message: Some("写入已进入待审区，主界面等待人工确认".to_string()),
            })
        }
        Decision::Direct => {
            let data = run_write(state, tool_name, args)?;
            record_audit(state, tool_name, args, risk, "direct")?;
            Ok(AiExecution {
                status: "ok",
                data: Some(data),
                inbox_id: None,
                message: None,
            })
        }
    }
}

fn enqueue(state: &AppState, tool_name: &str, args: &Value, risk: AiRisk) -> AppResult<String> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let id = new_id();
    let summary = args
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let node_id = args.get("nodeId").and_then(Value::as_str);
    ai_repository::insert_inbox(
        &session.connection,
        ai_repository::NewInboxItem {
            id: &id,
            tool: tool_name,
            node_id,
            payload_json: &args.to_string(),
            summary: &summary,
            risk: risk.as_str(),
            created_at: now_ms(),
        },
    )?;
    prune_history(&session.connection);
    Ok(id)
}

/// AI 历史写入后的收敛：只插不删的表按保留期与条数上限清理，失败只记日志、不影响主流程。
fn prune_history(connection: &rusqlite::Connection) {
    if let Err(error) = ai_repository::prune_history(connection, now_ms()) {
        logging::error("ai", &format!("AI 历史清理失败: {error}"));
    }
}

fn record_audit(
    state: &AppState,
    tool_name: &str,
    args: &Value,
    risk: AiRisk,
    outcome: &str,
) -> AppResult<()> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let summary = args.get("summary").and_then(Value::as_str).unwrap_or("");
    let node_id = args.get("nodeId").and_then(Value::as_str);
    ai_repository::insert_audit(
        &session.connection,
        ai_repository::NewAuditItem {
            id: &new_id(),
            tool: tool_name,
            node_id,
            summary,
            risk: risk.as_str(),
            outcome,
            created_at: now_ms(),
        },
    )?;
    prune_history(&session.connection);
    Ok(())
}

/// 审批通过：执行真实写入并落审批/审计记录。
pub fn approve(state: &AppState, inbox_id: &str) -> AppResult<Value> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let row = ai_repository::find_inbox(&session.connection, inbox_id)?
        .ok_or_else(|| AppError::not_found("待审项不存在"))?;
    if row.status != "pending" {
        return Err(AppError::conflict("该待审项已处理"));
    }
    let args: Value = serde_json::from_str(&row.payload_json)
        .map_err(|_| AppError::validation("待审项内容损坏"))?;
    // 先原子认领再执行：双击或并发审批只会有一个调用拿到这条记录。
    let claimed = ai_repository::claim_inbox(&session.connection, inbox_id, now_ms())?;
    if claimed == 0 {
        return Err(AppError::conflict("该待审项已处理"));
    }
    let workspace_id = session.workspace_id.clone();
    drop(guard);
    // run_write 要自己取工作区锁，认领与执行之间不能一直握着它；
    // 执行前再确认一次身份，避免用户在这空隙里切了工作区，把 A 的载荷写进 B。
    {
        let guard = state.workspace()?;
        let same = guard
            .as_ref()
            .is_some_and(|session| session.workspace_id == workspace_id);
        if !same {
            if let Some(session) = guard.as_ref() {
                let _ = ai_repository::fail_inbox(
                    &session.connection,
                    inbox_id,
                    "工作区已切换，未执行",
                    now_ms(),
                );
            }
            return Err(AppError::conflict("工作区已切换，请回到原工作区后重新确认"));
        }
    }
    let result = run_write(state, &row.tool, &args);
    match result {
        Ok(value) => {
            let guard = state.workspace()?;
            let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
            if session.workspace_id != workspace_id {
                // 写入已完成但工作区变了：审计必须留在它真正落库的那个库里。
                logging::error("ai", "审批执行后工作区已切换，跳过审计回写");
                return Ok(value);
            }
            let risk = match row.risk.as_str() {
                "high" => AiRisk::High,
                "medium" => AiRisk::Medium,
                _ => AiRisk::Low,
            };
            let summary = args.get("summary").and_then(Value::as_str).unwrap_or("");
            ai_repository::insert_audit(
                &session.connection,
                ai_repository::NewAuditItem {
                    id: &new_id(),
                    tool: &row.tool,
                    node_id: row.node_id.as_deref(),
                    summary,
                    risk: risk.as_str(),
                    outcome: "approved",
                    created_at: now_ms(),
                },
            )?;
            Ok(value)
        }
        Err(error) => {
            let message = error.to_string();
            let guard = state.workspace()?;
            match guard.as_ref() {
                Some(session) if session.workspace_id == workspace_id => {
                    ai_repository::fail_inbox(&session.connection, inbox_id, &message, now_ms())?;
                }
                // 写入失败后工作区已切换或已关闭：这条待审项在另一个库里（或无处可写），
                // 拿当前连接去标记会把状态写进无关的库，也可能直接失败让记录卡在
                // 「已认领但未执行」= 用户以为已生效。只记日志并把原因回给调用方。
                other => {
                    let note = match other {
                        Some(session) => format!("工作区已切到 {}", session.workspace_id),
                        None => "工作区已关闭".to_string(),
                    };
                    logging::error(
                        "ai",
                        &format!(
                            "审批执行失败且{note}，待审项 {inbox_id} 无法回写失败状态：{message}"
                        ),
                    );
                }
            }
            Err(error)
        }
    }
}

/// 拒绝待审项。
pub fn reject(state: &AppState, inbox_id: &str) -> AppResult<()> {
    let guard = state.workspace()?;
    let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
    let row = ai_repository::find_inbox(&session.connection, inbox_id)?
        .ok_or_else(|| AppError::not_found("待审项不存在"))?;
    let changed =
        ai_repository::decide_inbox(&session.connection, inbox_id, "rejected", None, now_ms())?;
    if changed == 0 {
        return Err(AppError::conflict("该待审项已处理"));
    }
    let risk = match row.risk.as_str() {
        "high" => AiRisk::High,
        "medium" => AiRisk::Medium,
        _ => AiRisk::Low,
    };
    let payload: Value = serde_json::from_str(&row.payload_json).unwrap_or(Value::Null);
    let summary = payload.get("summary").and_then(Value::as_str).unwrap_or("");
    ai_repository::insert_audit(
        &session.connection,
        ai_repository::NewAuditItem {
            id: &new_id(),
            tool: &row.tool,
            node_id: row.node_id.as_deref(),
            summary,
            risk: risk.as_str(),
            outcome: "rejected",
            created_at: now_ms(),
        },
    )?;
    Ok(())
}

fn run_read(state: &AppState, tool: &str, args: &Value) -> AppResult<Value> {
    match tool {
        "kb_list" => {
            let kbs = knowledge_base_service::list(state)?;
            Ok(json!({ "knowledgeBases": kbs }))
        }
        "kb_search" => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let kb_id = args
                .get("knowledgeBaseId")
                .and_then(Value::as_str)
                .unwrap_or("");
            if kb_id.is_empty() {
                return Err(AppError::validation("缺少 knowledgeBaseId"));
            }
            let hits = search_service::search(
                state,
                SearchNodesInput {
                    query: query.to_string(),
                    knowledge_base_id: kb_id.to_string(),
                    limit: args.get("limit").and_then(Value::as_i64).unwrap_or(20),
                },
            )?;
            Ok(json!({ "hits": hits }))
        }
        "node_tree" => {
            let kb_id = args
                .get("knowledgeBaseId")
                .and_then(Value::as_str)
                .unwrap_or("");
            if kb_id.is_empty() {
                return Err(AppError::validation("缺少 knowledgeBaseId"));
            }
            let nodes = node_service::list(state, kb_id)?;
            Ok(json!({ "nodes": nodes }))
        }
        "doc_read" => {
            let node_id = require_str(args, "nodeId")?;
            let loaded = document_service::load(state, node_id)?;
            let blocks = flatten_blocks(&loaded.document);
            Ok(
                json!({ "version": loaded.version, "blocks": blocks, "wordCount": loaded.word_count }),
            )
        }
        "board_read" => {
            let node_id = require_str(args, "nodeId")?;
            let loaded = board_service::load(state, node_id)?;
            Ok(json!({ "version": loaded.version, "elements": loaded.elements }))
        }
        "mindmap_read" => {
            let node_id = require_str(args, "nodeId")?;
            let loaded = mindmap_service::load(state, node_id)?;
            Ok(json!({ "version": loaded.version, "content": loaded.content }))
        }
        "inbox_list" => {
            let status = args.get("status").and_then(Value::as_str);
            Ok(json!({ "items": inbox(state, status)? }))
        }
        "inbox_get" => {
            let id = require_str(args, "inboxId")?;
            let guard = state.workspace()?;
            let session = guard.as_ref().ok_or(AppError::NoActiveWorkspace)?;
            let row = ai_repository::find_inbox(&session.connection, id)?;
            Ok(json!({ "item": row }))
        }
        _ => Err(AppError::validation("未知的读取工具")),
    }
}

fn run_write(state: &AppState, tool: &str, args: &Value) -> AppResult<Value> {
    match tool {
        "doc_create" => {
            let kb_id = require_str(args, "knowledgeBaseId")?;
            let parent_id = args.get("parentId").and_then(Value::as_str);
            let title = require_str(args, "title")?;
            let markdown = args.get("markdown").and_then(Value::as_str).unwrap_or("");
            let node = node_service::create(
                state,
                CreateNodeInput {
                    knowledge_base_id: kb_id.to_string(),
                    parent_id: parent_id.map(str::to_string),
                    node_type: 2,
                    title: title.to_string(),
                },
            )?;
            let document = json!({ "type": "doc", "content": markdown_blocks(markdown) });
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node.id.clone(),
                    document,
                    base_version: 0,
                },
            )?;
            Ok(json!({ "nodeId": node.id, "version": saved.version }))
        }
        "doc_append_blocks" => {
            let node_id = require_str(args, "nodeId")?;
            let blocks = bounded_array(args, "blocks")?;
            let loaded = document_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut document = loaded.document;
            let content = document
                .get_mut("content")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| AppError::validation("文档结构无效"))?;
            for block in blocks {
                content.push(build_block(&block)?);
            }
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node_id.to_string(),
                    document,
                    base_version: loaded.version,
                },
            )?;
            Ok(json!({ "version": saved.version, "wordCount": saved.word_count }))
        }
        "doc_update_block" => {
            let node_id = require_str(args, "nodeId")?;
            let block_id = require_str(args, "blockId")?;
            let text = require_str(args, "text")?;
            let loaded = document_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut document = loaded.document;
            let block = find_block_mut(&mut document, block_id)
                .ok_or_else(|| AppError::not_found("段落不存在"))?;
            block["content"] = json!([{ "type": "text", "text": text, "styles": {} }]);
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node_id.to_string(),
                    document,
                    base_version: loaded.version,
                },
            )?;
            Ok(json!({ "version": saved.version, "wordCount": saved.word_count }))
        }
        "doc_replace_range" => {
            let node_id = require_str(args, "nodeId")?;
            let start = args.get("start").and_then(Value::as_u64).unwrap_or(0) as usize;
            // 缺 end 时旧实现按 0 处理，start..0 是空区间：白写一版、块却被丢掉。
            let end = args
                .get("end")
                .and_then(Value::as_u64)
                .ok_or_else(|| AppError::validation("doc_replace_range 需要显式 end"))?
                as usize;
            let blocks = bounded_array(args, "blocks")?;
            let loaded = document_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut document = loaded.document;
            let content = document
                .get_mut("content")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| AppError::validation("文档结构无效"))?;
            if start > end || end > content.len() {
                return Err(AppError::validation("段落区间越界"));
            }
            let insertion: Vec<Value> = blocks
                .iter()
                .map(build_block)
                .collect::<AppResult<Vec<_>>>()?;
            content.splice(start..end, insertion);
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node_id.to_string(),
                    document,
                    base_version: loaded.version,
                },
            )?;
            Ok(json!({ "version": saved.version, "wordCount": saved.word_count }))
        }
        "board_add_elements" => {
            let node_id = require_str(args, "nodeId")?;
            let specs = bounded_array(args, "elements")?;
            let loaded = board_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut elements = loaded.elements.as_array().cloned().unwrap_or_default();
            for spec in specs {
                elements.push(build_board_element(&spec)?);
            }
            let saved = board_service::save(
                state,
                BoardSaveInput {
                    node_id: node_id.to_string(),
                    base_version: loaded.version,
                    elements: Value::Array(elements),
                    app_state: loaded.app_state,
                },
            )?;
            Ok(json!({ "version": saved.version, "elementCount": saved.element_count }))
        }
        "board_update_element" => {
            let node_id = require_str(args, "nodeId")?;
            let element_id = require_str(args, "elementId")?;
            let patch = args.get("patch").cloned().unwrap_or_else(|| json!({}));
            let loaded = board_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut elements = loaded.elements.as_array().cloned().unwrap_or_default();
            let target = elements
                .iter_mut()
                .find(|element| element.get("id").and_then(Value::as_str) == Some(element_id))
                .ok_or_else(|| AppError::not_found("画板元素不存在"))?;
            for key in [
                "text",
                "strokeColor",
                "backgroundColor",
                "x",
                "y",
                "width",
                "height",
            ] {
                if let Some(value) = patch.get(key) {
                    target[key] = value.clone();
                }
            }
            target["version"] =
                json!(target.get("version").and_then(Value::as_i64).unwrap_or(1) + 1);
            target["updated"] = json!(now_ms());
            let saved = board_service::save(
                state,
                BoardSaveInput {
                    node_id: node_id.to_string(),
                    base_version: loaded.version,
                    elements: Value::Array(elements),
                    app_state: loaded.app_state,
                },
            )?;
            Ok(json!({ "version": saved.version }))
        }
        "doc_insert_after_block" => {
            let node_id = require_str(args, "nodeId")?;
            let block_id = require_str(args, "blockId")?;
            let blocks = bounded_array(args, "blocks")?;
            if blocks.is_empty() {
                return Err(AppError::validation("缺少要插入的段落"));
            }
            let loaded = document_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut document = loaded.document;
            let built = blocks
                .iter()
                .map(build_block)
                .collect::<AppResult<Vec<_>>>()?;
            if !insert_after_in_tree(&mut document, block_id, &built) {
                return Err(AppError::not_found("段落不存在"));
            }
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node_id.to_string(),
                    document,
                    base_version: loaded.version,
                },
            )?;
            Ok(json!({ "version": saved.version, "wordCount": saved.word_count }))
        }
        "doc_delete_block" => {
            let node_id = require_str(args, "nodeId")?;
            let block_id = require_str(args, "blockId")?;
            let loaded = document_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let mut document = loaded.document;
            if !remove_block_in_tree(&mut document, block_id) {
                return Err(AppError::not_found("段落不存在"));
            }
            let saved = document_service::save(
                state,
                SaveDocumentInput {
                    node_id: node_id.to_string(),
                    document,
                    base_version: loaded.version,
                },
            )?;
            Ok(json!({ "version": saved.version, "wordCount": saved.word_count }))
        }
        "board_delete_elements" => {
            let node_id = require_str(args, "nodeId")?;
            let ids: Vec<String> = args
                .get("elementIds")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            if ids.is_empty() {
                return Err(AppError::validation("缺少要删除的元素 id"));
            }
            if ids.len() > MAX_WRITE_ITEMS {
                return Err(AppError::validation(format!(
                    "elementIds 最多 {MAX_WRITE_ITEMS} 项，收到 {} 项",
                    ids.len()
                )));
            }
            let loaded = board_service::load(state, node_id)?;
            ensure_version(args, loaded.version)?;
            let elements = loaded
                .elements
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|element| {
                    let id = element.get("id").and_then(Value::as_str).unwrap_or("");
                    !ids.iter().any(|target| target == id)
                })
                .collect::<Vec<_>>();
            let saved = board_service::save(
                state,
                BoardSaveInput {
                    node_id: node_id.to_string(),
                    base_version: loaded.version,
                    elements: Value::Array(elements),
                    app_state: loaded.app_state,
                },
            )?;
            Ok(json!({ "version": saved.version, "elementCount": saved.element_count }))
        }
        "node_rename" => {
            let node_id = require_str(args, "nodeId")?;
            let title = require_str(args, "title")?;
            let node = node_service::update(
                state,
                crate::models::UpdateNodeInput {
                    id: node_id.to_string(),
                    title: Some(title.to_string()),
                    starred: None,
                },
            )?;
            Ok(json!({ "nodeId": node.id, "title": node.title }))
        }
        "node_move" => {
            let node_id = require_str(args, "nodeId")?;
            let parent_id = args
                .get("parentId")
                .and_then(Value::as_str)
                .map(str::to_string);
            let index = args.get("index").and_then(Value::as_i64).unwrap_or(0);
            let nodes = node_service::move_node(
                state,
                crate::models::MoveNodeInput {
                    id: node_id.to_string(),
                    parent_id,
                    index,
                },
            )?;
            Ok(json!({ "count": nodes.len() }))
        }
        "node_create_folder" => {
            let kb_id = require_str(args, "knowledgeBaseId")?;
            let parent_id = args.get("parentId").and_then(Value::as_str);
            let title = require_str(args, "title")?;
            let node = node_service::create(
                state,
                CreateNodeInput {
                    knowledge_base_id: kb_id.to_string(),
                    parent_id: parent_id.map(str::to_string),
                    node_type: 1,
                    title: title.to_string(),
                },
            )?;
            Ok(json!({ "nodeId": node.id, "title": node.title }))
        }
        "node_trash" => {
            let node_id = require_str(args, "nodeId")?;
            let result = node_service::delete(state, node_id)?;
            Ok(json!({ "deletedCount": result.deleted_count }))
        }
        _ => Err(AppError::validation("未知的写入工具")),
    }
}

fn require_str<'a>(args: &'a Value, key: &str) -> AppResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AppError::validation(format!("缺少参数 {key}")))
}

/// 单次写入允许的条目上限。
///
/// MCP 参数来自外部客户端，不设上限时一次调用就能塞进任意多个块或元素，
/// 把整篇文档重写的耗时和内存都变成调用方可控的。
const MAX_WRITE_ITEMS: usize = 500;

/// 取一个有界数组参数；缺失或空返回空表，超上限直接报错而不是静默截断。
fn bounded_array(args: &Value, key: &str) -> AppResult<Vec<Value>> {
    let items = args
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if items.len() > MAX_WRITE_ITEMS {
        return Err(AppError::validation(format!(
            "{key} 最多 {MAX_WRITE_ITEMS} 项，收到 {} 项",
            items.len()
        )));
    }
    Ok(items)
}

fn ensure_version(args: &Value, current: i64) -> AppResult<()> {
    if let Some(expected) = args.get("expectedVersion").and_then(Value::as_i64)
        && expected != current
    {
        return Err(AppError::conflict("版本已变化，请重新读取后再写入"));
    }
    Ok(())
}

/// 文档块展平：返回 blockId/类型/文本/深度。
pub fn flatten_blocks(document: &Value) -> Vec<Value> {
    let mut rows = Vec::new();
    fn walk(blocks: &[Value], depth: usize, rows: &mut Vec<Value>) {
        for block in blocks {
            let id = block.get("id").and_then(Value::as_str).unwrap_or("");
            let kind = block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("paragraph");
            let text = block_text(block);
            rows.push(json!({ "blockId": id, "type": kind, "text": text, "depth": depth }));
            if let Some(children) = block.get("children").and_then(Value::as_array) {
                walk(children, depth + 1, rows);
            }
        }
    }
    if let Some(content) = document.get("content").and_then(Value::as_array) {
        walk(content, 0, &mut rows);
    }
    rows
}

fn block_text(block: &Value) -> String {
    let mut text = String::new();
    if let Some(items) = block.get("content").and_then(Value::as_array) {
        for item in items {
            if let Some(value) = item.get("text").and_then(Value::as_str) {
                text.push_str(value);
            }
        }
    }
    text
}

fn find_block_mut<'a>(document: &'a mut Value, block_id: &str) -> Option<&'a mut Value> {
    fn walk<'a>(blocks: &'a mut [Value], block_id: &str) -> Option<&'a mut Value> {
        for block in blocks {
            if block.get("id").and_then(Value::as_str) == Some(block_id) {
                return Some(block);
            }
            if let Some(children) = block.get_mut("children").and_then(Value::as_array_mut)
                && let Some(found) = walk(children, block_id)
            {
                return Some(found);
            }
        }
        None
    }
    let content = document.get_mut("content")?.as_array_mut()?;
    walk(content, block_id)
}

/// 在指定段落之后插入块；返回是否找到锚点。
fn insert_after_in_tree(document: &mut Value, block_id: &str, blocks: &[Value]) -> bool {
    fn walk(list: &mut Vec<Value>, block_id: &str, blocks: &[Value]) -> bool {
        if let Some(index) = list
            .iter()
            .position(|block| block.get("id").and_then(Value::as_str) == Some(block_id))
        {
            for (cursor, block) in (index + 1..).zip(blocks.iter()) {
                list.insert(cursor, block.clone());
            }
            return true;
        }
        for block in list.iter_mut() {
            if let Some(children) = block.get_mut("children").and_then(Value::as_array_mut)
                && walk(children, block_id, blocks)
            {
                return true;
            }
        }
        false
    }
    let Some(content) = document.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };
    walk(content, block_id, blocks)
}

/// 从块树中删除指定段落（含子块）；返回是否找到。
fn remove_block_in_tree(document: &mut Value, block_id: &str) -> bool {
    fn walk(list: &mut Vec<Value>, block_id: &str) -> bool {
        if let Some(index) = list
            .iter()
            .position(|block| block.get("id").and_then(Value::as_str) == Some(block_id))
        {
            list.remove(index);
            return true;
        }
        for block in list.iter_mut() {
            if let Some(children) = block.get_mut("children").and_then(Value::as_array_mut)
                && walk(children, block_id)
            {
                return true;
            }
        }
        false
    }
    let Some(content) = document.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };
    walk(content, block_id)
}

/// 构造 BlockNote 段落。
fn build_block(spec: &Value) -> AppResult<Value> {
    let text = spec.get("text").and_then(Value::as_str).unwrap_or("");
    let kind = spec
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("paragraph");
    let allowed = [
        "paragraph",
        "heading",
        "bulletListItem",
        "numberedListItem",
        "checkListItem",
        "codeBlock",
    ];
    if !allowed.contains(&kind) {
        return Err(AppError::validation("不支持的段落类型"));
    }
    let mut block = json!({
        "id": new_id(),
        "type": kind,
        "props": {},
        "content": [{ "type": "text", "text": text, "styles": {} }],
        "children": []
    });
    if kind == "heading" {
        block["props"] = json!({ "level": spec.get("level").and_then(Value::as_u64).unwrap_or(2) });
    }
    Ok(block)
}

/// Markdown 简版解析：标题/列表/代码块/段落。
fn markdown_blocks(markdown: &str) -> Vec<Value> {
    let mut blocks = Vec::new();
    let mut in_code = false;
    for line in markdown.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim_start().starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            blocks.push(json!({
                "id": new_id(), "type": "paragraph", "props": {},
                "content": [{ "type": "text", "text": trimmed, "styles": { "code": true } }],
                "children": []
            }));
            continue;
        }
        if trimmed.trim().is_empty() {
            continue;
        }
        let heading = trimmed.trim_start().starts_with('#');
        if heading {
            let level = trimmed
                .chars()
                .take_while(|c| *c == '#')
                .count()
                .clamp(1, 3);
            let text = trimmed.trim_start_matches('#').trim();
            blocks.push(json!({
                "id": new_id(), "type": "heading", "props": { "level": level },
                "content": [{ "type": "text", "text": text, "styles": {} }],
                "children": []
            }));
        } else if trimmed.trim_start().starts_with("- ") {
            blocks.push(json!({
                "id": new_id(), "type": "bulletListItem", "props": {},
                "content": [{ "type": "text", "text": trimmed.trim_start()[2..].to_string(), "styles": {} }],
                "children": []
            }));
        } else {
            blocks.push(json!({
                "id": new_id(), "type": "paragraph", "props": {},
                "content": [{ "type": "text", "text": trimmed.to_string(), "styles": {} }],
                "children": []
            }));
        }
    }
    blocks
}

/// 构造 Excalidraw 元素。
fn build_board_element(spec: &Value) -> AppResult<Value> {
    let kind = spec
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("rectangle");
    let allowed = ["rectangle", "ellipse", "diamond", "text", "arrow", "line"];
    if !allowed.contains(&kind) {
        return Err(AppError::validation("不支持的画板元素类型"));
    }
    let number = |key: &str, default: f64| spec.get(key).and_then(Value::as_f64).unwrap_or(default);
    let mut element = json!({
        "id": format!("ai-{}", new_id()),
        "type": kind,
        "x": number("x", 0.0),
        "y": number("y", 0.0),
        "width": number("width", 160.0),
        "height": number("height", 96.0),
        "angle": 0,
        "strokeColor": spec.get("strokeColor").and_then(Value::as_str).unwrap_or("#5c8f83"),
        "backgroundColor": spec.get("backgroundColor").and_then(Value::as_str).unwrap_or("transparent"),
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "seed": now_ms() % 1_000_000,
        "version": 1,
        "versionNonce": 0,
        "isDeleted": false,
        "boundElements": null,
        "updated": now_ms(),
        "link": null,
        "locked": false,
        "groupIds": [],
        "roundness": { "type": 3 }
    });
    if kind == "text" {
        let text = spec.get("text").and_then(Value::as_str).unwrap_or("");
        element["text"] = json!(text);
        element["originalText"] = json!(text);
        element["fontSize"] = json!(16);
        element["fontFamily"] = json!(1);
        element["textAlign"] = json!("left");
        element["verticalAlign"] = json!("top");
        element["lineHeight"] = json!(1.25);
        element["containerId"] = Value::Null;
    }
    if kind == "arrow" || kind == "line" {
        element["points"] = json!([[0, 0], [number("width", 160.0), number("height", 0.0)]]);
        element["startBinding"] = Value::Null;
        element["endBinding"] = Value::Null;
        element["lastCommittedPoint"] = Value::Null;
        element["startArrowhead"] = Value::Null;
        element["endArrowhead"] = if kind == "arrow" {
            json!("arrow")
        } else {
            Value::Null
        };
    }
    Ok(element)
}
