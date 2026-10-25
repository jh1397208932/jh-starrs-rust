//! 从文档/画板内容中提取附件对象引用。
//!
//! 引用关系只认最终保存的 JSON：文档看 attachment 节点的 `attrs.attachmentId`，
//! 画板看 image.fileId 与文件卡片 `customData.objectId`。保存、迁移回填和导出都复用
//! 这里的判据，避免三处各写一套。

use std::collections::BTreeSet;

use serde_json::Value;

/// 提取文档中的附件 object_id。
///
/// @param document 文档 JSON（doc 根节点）
/// @returns 去重后的 object_id 集合
/// @example collect_document_attachment_ids(&json!({"content":[]}))
pub fn collect_document_attachment_ids(document: &Value) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    collect_document_value(document, &mut ids);
    ids
}

fn collect_document_value(value: &Value, ids: &mut BTreeSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_document_value(item, ids);
            }
        }
        Value::Object(object) => {
            let kind = object.get("type").and_then(Value::as_str);
            if matches!(kind, Some("attachmentImage" | "attachmentBlock"))
                && let Some(attachment_id) = object
                    .get("attrs")
                    .and_then(|attrs| attrs.get("attachmentId"))
                    .and_then(Value::as_str)
                && !attachment_id.is_empty()
            {
                ids.insert(attachment_id.to_string());
            }
            for child in object.values() {
                collect_document_value(child, ids);
            }
        }
        _ => {}
    }
}

/// 提取画板图元中的附件 object_id。
///
/// @param elements Excalidraw elements 数组
/// @returns 去重后的 object_id 集合
/// @example collect_board_attachment_ids(&json!([]))
pub fn collect_board_attachment_ids(elements: &Value) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let Some(array) = elements.as_array() else {
        return ids;
    };
    for element in array {
        if element.get("type").and_then(Value::as_str) == Some("image")
            && let Some(file_id) = element.get("fileId").and_then(Value::as_str)
            && !file_id.is_empty()
        {
            ids.insert(file_id.to_string());
        }
        if let Some(custom) = element.get("customData").and_then(Value::as_object)
            && custom
                .get("boardFileCard")
                .and_then(Value::as_bool)
                .is_some_and(|value| value)
            && let Some(object_id) = custom.get("objectId").and_then(Value::as_str)
            && !object_id.is_empty()
        {
            ids.insert(object_id.to_string());
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn collects_nested_document_attachment_ids_once() {
        let document = json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "attachmentImage", "attrs": {"attachmentId": "a1"}},
                        {"type": "attachmentBlock", "attrs": {"attachmentId": "a2"}}
                    ]
                },
                {"type": "attachmentImage", "attrs": {"attachmentId": "a1"}},
                {"type": "attachmentImage", "attrs": {"attachmentId": ""}},
                {"type": "image", "attrs": {"src": "attachment://ignored"}}
            ]
        });
        let ids = collect_document_attachment_ids(&document);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("a1"));
        assert!(ids.contains("a2"));
    }

    #[test]
    fn collects_board_image_and_file_card_ids() {
        let elements = json!([
            {"type": "image", "fileId": "img-1"},
            {"type": "image", "fileId": ""},
            {"type": "rectangle", "customData": {"boardFileCard": true, "objectId": "file-1"}},
            {"type": "rectangle", "customData": {"boardFileCard": false, "objectId": "ignored"}},
            {"type": "rectangle", "customData": {"objectId": "ignored-2"}}
        ]);
        let ids = collect_board_attachment_ids(&elements);
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("img-1"));
        assert!(ids.contains("file-1"));
    }
}
