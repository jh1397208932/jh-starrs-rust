---
name: starris-memory
description: 把星屿（Starris）本地知识库当作 agent 的记忆后端。检索、读段落、建笔记、回写结论，写入按只读/待审/可编辑权限执行，高风险操作需人工确认。用户提到星屿知识库、本地笔记、MCP 记忆后端或要往库里写内容时使用
---

# Starris Memory（MCP 记忆后端）

MCP 是星屿客户端自带的能力：打开星屿后，客户端在本机 `127.0.0.1` 上托管一个 HTTP MCP 服务，工具的读写复用客户端当前工作区与权限体系；关闭星屿，服务随即停止。它不是可以单独运行的程序，也没有独立的数据库连接。

## 连接

1. 打开星屿 → 设置 → AI 协作 → MCP 服务，确认状态为「运行中」。
2. 复制「服务地址」与「访问令牌」。

```jsonc
// MCP 客户端配置示例（Streamable HTTP）
{
  "mcpServers": {
    "starris": {
      "type": "http",
      "url": "http://127.0.0.1:47821/mcp",
      "headers": { "Authorization": "Bearer <在设置中复制的令牌>" }
    }
  }
}
```

- 端口默认 `47821`（可用 `STARRIS_MCP_PORT` 覆盖，设置页会显示实际地址）。
- 令牌保存在本机全局库，可在设置里重置；重置后旧配置立即失效。
- 服务仅监听回环地址，无令牌请求返回 401；关闭开关或退出客户端后端点不可达。
- 每个工具都带有完整的 `inputSchema`（required + properties），按 schema 传参即可；写入类工具请带 `summary`。

## 权限模型（先读再写）

- 每个作用域（doc / board / mindmap）有独立模式：`read-only`、`review`（默认）、`editable`。
- 高风险工具（`doc_replace_range`、`doc_delete_block`、`board_delete_elements`、`node_trash`）**任何模式**都会进入待审区。
- `node_*` 系列按**目标节点的实际类型**取作用域：画板节点走 board，思维导图节点走 mindmap；文档、文件夹、附件等树结构走 doc。
- 同一条待审项只能被审批一次；重复审批会返回冲突，不会重复写入。
- 写入返回三种状态：
  - `ok`：已落库；
  - `pending_review`：进入桌面端「设置 → AI 协作 → 待审区」，附带 `inboxId`；
  - `denied`：当前作用域只读，错误码 `PERMISSION_DENIED`。
- 写入前请带 `summary`（动机摘要），它会显示在待审区与审计日志里，方便人做决定。

## 推荐工作流

1. `kb_list` 找到知识库与根级节点。
2. `kb_search`（或 `node_tree`）定位目标；`doc_read` 拿到 `blockId + version` 作为后续写入的锚点。
3. 提出修改：`doc_update_block` / `doc_append_blocks`；批量重排用 `doc_replace_range`（高风险，需审批）。
4. 若返回 `pending_review`，用 `inbox_get` 轮询：
   - `approved`：修改已落库；
   - `rejected`：人拒绝了这次写入，不要重试同样内容；
   - `failed`：执行失败（常见 `版本已变化`），重新 `doc_read` 后再提交。
5. 写完后用 `doc_read` 复核结果。

## 工具速查

| 工具 | 风险 | 关键参数 |
|---|---|---|
| `kb_list` | 无 | — |
| `kb_search` | 无 | `query`、`knowledgeBaseId`、`limit` |
| `node_tree` | 无 | `knowledgeBaseId` |
| `doc_read` | 无 | `nodeId` → `{version, blocks:[{blockId,type,text,depth}]}` |
| `board_read` | 无 | `nodeId` → Excalidraw elements |
| `mindmap_read` | 无 | `nodeId` → canonical JSON |
| `inbox_list` / `inbox_get` | 无 | `status` / `inboxId` |
| `doc_create` | 低 | `knowledgeBaseId`、`title`、`markdown` |
| `doc_append_blocks` | 低 | `blocks:[{type,text,level?}]` |
| `doc_update_block` | 中 | `blockId`、`text`、`expectedVersion?` |
| `doc_replace_range` | 高 | `start`、`end`、`blocks` |
| `doc_insert_after_block` | 中 | `blockId`、`blocks`（在其后插入） |
| `doc_delete_block` | 高 | `blockId`（连同子块删除） |
| `board_add_elements` | 低 | `elements:[{type,x,y,width,height,text?,strokeColor?,backgroundColor?}]` |
| `board_update_element` | 中 | `elementId`、`patch:{text?,strokeColor?,x?,y?,width?,height?}` |
| `board_delete_elements` | 高 | `elementIds:[...]` |
| `node_rename` | 中 | `nodeId`、`title`（走文档作用域权限） |
| `node_move` | 中 | `nodeId`、`parentId`、`index`（走文档作用域权限） |
| `node_create_folder` | 低 | `knowledgeBaseId`、`title`、`parentId?`（走文档作用域权限） |
| `node_trash` | 高 | `nodeId`（进回收站，可恢复） |

段落类型：`paragraph`、`heading`（`level` 1–3）、`bulletListItem`、`numberedListItem`、`checkListItem`、`codeBlock`。

## 纪律

- 永远先 `doc_read` 再写，带上 `expectedVersion` 避免覆盖别人的编辑。
- 一次写入只做一件事，`summary` 用一句中文说清楚「改什么、为什么」。
- 收到 `rejected` 不要换皮重试；把理由转述给用户。
- 不要把整篇文档重写成一段：优先块级修改，保留人的原有结构。
