#!/usr/bin/env node
/**
 * 客户端内置 MCP（HTTP）烟雾测试。
 *
 * 先启动星屿，在「设置 → AI 协作 → MCP 服务」复制地址与令牌，然后：
 *   MCP_URL=http://127.0.0.1:47821/mcp MCP_TOKEN=<令牌> node test/mcp/smoke.mjs
 *
 * 服务随客户端启停；未启动客户端时本脚本会直接失败，这是预期行为。
 */
const URL = process.env.MCP_URL;
const TOKEN = process.env.MCP_TOKEN;

if (!URL || !TOKEN) {
  console.error("缺少 MCP_URL / MCP_TOKEN。请先在星屿设置里复制 MCP 地址与令牌。");
  process.exit(2);
}

async function rpc(body, authorized = true) {
  const response = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

const health = await fetch(URL.replace(/\/mcp$/, "/health")).catch(() => null);
assert(Boolean(health?.ok), "客户端 MCP 服务在运行（/health）");

const unauthorized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, false);
assert(unauthorized.status === 401, "无令牌请求返回 401");

const init = await rpc({
  jsonrpc: "2.0",
  id: 2,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
});
assert(init.payload?.result?.serverInfo?.name === "starris-mcp", "initialize 返回 serverInfo");

const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
const tools = list.payload?.result?.tools ?? [];
assert(tools.length >= 21, `工具数量 ≥21（实际 ${tools.length}）`);
assert(tools.every((tool) => tool.inputSchema && typeof tool.inputSchema === "object"), "每个工具都有 inputSchema");

const expectedRequired = {
  doc_read: "nodeId",
  doc_update_block: "blockId",
  board_add_elements: "elements",
  node_rename: "title",
};
for (const [name, key] of Object.entries(expectedRequired)) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert(Boolean(tool), `包含工具 ${name}`);
  assert((tool.inputSchema?.required ?? []).includes(key), `${name} 的 schema 要求 ${key}`);
}

const call = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "kb_list", arguments: {} } });
const text = call.payload?.result?.content?.[0]?.text ?? "";
assert(text.includes("knowledgeBases"), "tools/call kb_list 返回工作区数据");

console.log("MCP HTTP 烟雾测试通过");
