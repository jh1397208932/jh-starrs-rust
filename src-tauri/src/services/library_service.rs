//! 组件库用例：预设 seed、导入 `.excalidrawlib`、启用/禁用与画板组件读取。

use std::fs;
use std::path::Path;

use rusqlite::TransactionBehavior;
use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::logging;
use crate::models::library::{
    DeleteLibraryResult, ImportLibraryInput, LibraryDto, LibraryItemDto, LibrarySourceType,
    SetLibraryEnabledInput,
};
use crate::repositories::library_repository::{self as repository, NewLibrary};
use crate::state::{AppState, WorkspaceSession};
use crate::utils::{new_id, now_ms};

/// 单个导入库文件上限，防止异常文件撑爆工作区库。
const MAX_LIBRARY_BYTES: u64 = 32 * 1024 * 1024;
/// 单个组件库的组件数量上限：侧栏列表与缩略图生成都是 O(组件数)，超大库要求拆分导入。
const MAX_LIBRARY_ITEMS: usize = 2_000;

struct PresetLibrary {
    key: &'static str,
    name: &'static str,
    author: &'static str,
    source_url: &'static str,
    enabled: bool,
    json: &'static str,
}

/// 内置预设；按领域挑选，较大的图标包（AWS 等）仍可通过导入使用。
const PRESETS: &[PresetLibrary] = &[
    PresetLibrary {
        key: "starris-kit",
        name: "星屿基础组件",
        author: "Starris",
        source_url: "",
        enabled: true,
        json: include_str!("../../resources/libraries/starris-kit.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-basic-shapes",
        name: "基础形状",
        author: "Pablo Gil Fernández",
        source_url: "https://libraries.excalidraw.com/libraries/pgilfernandez/basic-shapes.excalidrawlib",
        enabled: true,
        json: include_str!("../../resources/libraries/basic-shapes.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-uml-er",
        name: "UML 与 ER 图",
        author: "BjoernKW",
        source_url: "https://libraries.excalidraw.com/libraries/BjoernKW/UML-ER-library.excalidrawlib",
        enabled: true,
        json: include_str!("../../resources/libraries/UML-ER-library.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-wireframe",
        name: "线框与 UX 元素",
        author: "gabi.macakova",
        source_url: "https://libraries.excalidraw.com/libraries/gabrielamacakova/basic-ux-wireframing-elements.excalidrawlib",
        enabled: true,
        json: include_str!("../../resources/libraries/basic-ux-wireframing-elements.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-software-architecture",
        name: "软件架构",
        author: "Youri Tjang",
        source_url: "https://libraries.excalidraw.com/libraries/youritjang/software-architecture.excalidrawlib",
        enabled: true,
        json: include_str!("../../resources/libraries/software-architecture.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-sticky-notes",
        name: "便签",
        author: "ferminrp",
        source_url: "https://libraries.excalidraw.com/libraries/ferminrp/post-it.excalidrawlib",
        enabled: true,
        json: include_str!("../../resources/libraries/post-it.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-cloud-patterns",
        name: "云架构模式",
        author: "Michel Caradec",
        source_url: "https://libraries.excalidraw.com/libraries/michelcaradec/cloud-design-patterns.excalidrawlib",
        enabled: false,
        json: include_str!("../../resources/libraries/cloud-design-patterns.excalidrawlib"),
    },
    PresetLibrary {
        key: "starris-data-viz",
        name: "数据可视化",
        author: "dbs-sticky",
        source_url: "https://libraries.excalidraw.com/libraries/dbssticky/data-viz.excalidrawlib",
        enabled: false,
        json: include_str!("../../resources/libraries/data-viz.excalidrawlib"),
    },
];

struct ParsedItem {
    name: String,
    elements_json: String,
}

/// 列出组件库（会先补齐内置预设）。
pub fn list(state: &AppState) -> AppResult<Vec<LibraryDto>> {
    with_session(state, |session| {
        ensure_presets(&session.connection)?;
        repository::list(&session.connection)?
            .into_iter()
            .map(|row| row.to_dto())
            .collect()
    })
}

/// 读取所有启用库的组件，供画板 Library 侧栏使用。
pub fn enabled_items(state: &AppState) -> AppResult<Vec<LibraryItemDto>> {
    with_session(state, |session| {
        ensure_presets(&session.connection)?;
        Ok(repository::enabled_items(&session.connection)?)
    })
}

/// 导入一个 `.excalidrawlib` 文件。
pub fn import(state: &AppState, input: ImportLibraryInput) -> AppResult<LibraryDto> {
    let path = Path::new(&input.path);
    if !path.is_file() {
        return Err(AppError::validation("组件库文件不存在"));
    }
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_LIBRARY_BYTES {
        return Err(AppError::validation("组件库文件过大"));
    }
    let bytes = fs::read(path)?;
    let items = parse_library(&bytes)?;
    if items.is_empty() {
        return Err(AppError::validation("组件库中没有可用组件"));
    }
    let fallback_name = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("导入组件库");
    let name = input.name.as_deref().unwrap_or(fallback_name).trim();
    if name.is_empty() {
        return Err(AppError::validation("组件库名称不能为空"));
    }
    let author = input.author.unwrap_or_default();
    let license = input.license.unwrap_or_default();
    let source_url = input.source_url.unwrap_or_default();
    let now = now_ms();
    let library_id = new_id();
    with_session(state, |session| {
        let connection = &mut session.connection;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        repository::insert_library(
            &transaction,
            &NewLibrary {
                id: &library_id,
                preset_key: None,
                name,
                author: &author,
                license: &license,
                source_url: &source_url,
                source_type: LibrarySourceType::Import,
                enabled: true,
                item_count: items.len() as i64,
                created_at: now,
                updated_at: now,
            },
        )?;
        for (index, item) in items.iter().enumerate() {
            repository::insert_item(
                &transaction,
                &new_id(),
                &library_id,
                &item.name,
                &item.elements_json,
                index as i64,
                now,
            )?;
        }
        transaction.commit()?;
        logging::info(
            "library",
            &format!("导入组件库 name={name} items={}", items.len()),
        );
        Ok(())
    })?;
    let row = with_session(state, |session| {
        repository::find(&session.connection, &library_id)?
            .ok_or_else(|| AppError::not_found("组件库不存在"))
    })?;
    row.to_dto()
}

/// 启用/禁用组件库。
pub fn set_enabled(state: &AppState, input: SetLibraryEnabledInput) -> AppResult<LibraryDto> {
    with_session(state, |session| {
        let updated =
            repository::set_enabled(&session.connection, &input.id, input.enabled, now_ms())?;
        if updated == 0 {
            return Err(AppError::not_found("组件库不存在"));
        }
        let row = repository::find(&session.connection, &input.id)?
            .ok_or_else(|| AppError::not_found("组件库不存在"))?;
        row.to_dto()
    })
}

/// 删除导入库；预设库只能禁用，不能删除。
pub fn delete(state: &AppState, id: &str) -> AppResult<DeleteLibraryResult> {
    with_session(state, |session| {
        let row = repository::find(&session.connection, id)?
            .ok_or_else(|| AppError::not_found("组件库不存在"))?;
        if row.source_type == LibrarySourceType::Preset.as_db() {
            return Err(AppError::validation("预设组件库不能删除"));
        }
        let deleted_items = repository::item_count(&session.connection, id)?;
        repository::delete(&session.connection, id)?;
        logging::info(
            "library",
            &format!("删除组件库 id={id} items={deleted_items}"),
        );
        Ok(DeleteLibraryResult { deleted_items })
    })
}

/// 补齐未 seed 的内置预设；已存在的 preset_key 不重复插入。
fn ensure_presets(connection: &rusqlite::Connection) -> AppResult<()> {
    let existing: std::collections::HashSet<String> =
        repository::preset_keys(connection)?.into_iter().collect();
    let missing: Vec<&PresetLibrary> = PRESETS
        .iter()
        .filter(|preset| !existing.contains(preset.key))
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let now = now_ms();
    let transaction = connection.unchecked_transaction()?;
    for preset in missing {
        let items = parse_library(preset.json.as_bytes())?;
        if items.is_empty() {
            logging::error("library", &format!("预设组件库为空 key={}", preset.key));
            continue;
        }
        let library_id = new_id();
        repository::insert_library(
            &transaction,
            &NewLibrary {
                id: &library_id,
                preset_key: Some(preset.key),
                name: preset.name,
                author: preset.author,
                license: "MIT",
                source_url: preset.source_url,
                source_type: LibrarySourceType::Preset,
                enabled: preset.enabled,
                item_count: items.len() as i64,
                created_at: now,
                updated_at: now,
            },
        )?;
        for (index, item) in items.iter().enumerate() {
            repository::insert_item(
                &transaction,
                &new_id(),
                &library_id,
                &item.name,
                &item.elements_json,
                index as i64,
                now,
            )?;
        }
        logging::info(
            "library",
            &format!("seed 预设组件库 key={} items={}", preset.key, items.len()),
        );
    }
    transaction.commit()?;
    Ok(())
}

/// 解析 v1/v2 `.excalidrawlib`；只保存组件元素数组。
fn parse_library(bytes: &[u8]) -> AppResult<Vec<ParsedItem>> {
    let data: Value =
        serde_json::from_slice(bytes).map_err(|_| AppError::validation("组件库文件无效"))?;
    if data.get("type").and_then(Value::as_str) != Some("excalidrawlib") {
        return Err(AppError::validation("组件库文件无效"));
    }
    let library = data
        .get("libraryItems")
        .and_then(Value::as_array)
        .or_else(|| data.get("library").and_then(Value::as_array))
        .ok_or_else(|| AppError::validation("组件库文件无效"))?;
    let mut items = Vec::new();
    for entry in library {
        let (name, elements) = if entry.is_array() {
            (String::new(), entry.as_array())
        } else {
            (
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                entry.get("elements").and_then(Value::as_array),
            )
        };
        let Some(elements) = elements else {
            continue;
        };
        if elements.is_empty() {
            continue;
        }
        if items.len() == MAX_LIBRARY_ITEMS {
            return Err(AppError::validation(format!(
                "组件库组件过多（最多 {MAX_LIBRARY_ITEMS} 个），请拆分后再导入"
            )));
        }
        let elements_json = serde_json::to_string(elements).map_err(|error| {
            logging::error("library", &format!("组件元素序列化失败: {error}"));
            AppError::Internal
        })?;
        items.push(ParsedItem {
            name,
            elements_json,
        });
    }
    Ok(items)
}

fn with_session<T>(
    state: &AppState,
    action: impl FnOnce(&mut WorkspaceSession) -> AppResult<T>,
) -> AppResult<T> {
    let mut guard = state.workspace()?;
    let session = guard.as_mut().ok_or(AppError::NoActiveWorkspace)?;
    action(session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn library_import_rejects_too_many_items() {
        let items: Vec<Value> = (0..=MAX_LIBRARY_ITEMS)
            .map(|index| {
                json!({
                    "name": format!("item-{index}"),
                    "elements": [{"id": format!("element-{index}"), "type": "rectangle"}]
                })
            })
            .collect();
        let bytes = serde_json::to_vec(&json!({
            "type": "excalidrawlib",
            "version": 2,
            "libraryItems": items
        }))
        .expect("序列化测试库");
        let error = match parse_library(&bytes) {
            Ok(_) => panic!("超量组件库必须拒绝"),
            Err(error) => error,
        };
        assert!(
            format!("{error}").contains("组件过多"),
            "错误信息要说明组件过多：{error}"
        );
    }
}
