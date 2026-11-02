import assert from "node:assert/strict";

/**
 * MCP 写入的人工确认：agent 通过本机 MCP 发起写入 → 主界面弹出前后对比窗 →
 * 批准才落库、拒绝则一条都不写。
 *
 * 文档作用域默认「需人工确认」，因此 doc_create 必然进入待审区而不是直写。
 */

const BASE = "http://127.0.0.1:47822";
const RPC_URL = `${BASE}/mcp`;

async function waitForHealth(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return;
    } catch {
      // 服务尚未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("客户端 MCP 服务未在 20s 内就绪");
}

async function rpc(id, method, params, token) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

async function callWriteTool(token, name, args) {
  const call = await rpc(7, "tools/call", { name, arguments: args }, token);
  const text = call.payload?.result?.content?.[0]?.text ?? "";
  if (call.payload?.result?.isError) throw new Error(`${name} 调用失败：${text.slice(0, 200)}`);
  return text;
}

export default {
  id: "29-mcp-review",
  title: "MCP 写入 · 主界面对比确认 · 批准落库与拒绝不写",
  area: "AI 协作 / MCP",
  steps: [
    {
      action: "agent 通过 MCP 发起 doc_create",
      ui: "HTTP POST /mcp → tools/call",
      clicks: 0,
      dialogs: 0,
      note: "文档作用域默认需人工确认：工具返回 pending_review，不写库。",
    },
    {
      action: "主界面弹出前后对比确认窗",
      ui: "星屿主窗口中央「AI 写入待确认」弹窗",
      clicks: 0,
      dialogs: 1,
      note: "弹窗列出工具、风险、目标与新增/移除行；批准前节点不在数据库里。",
    },
    {
      action: "点「确认执行」后节点与文档落库",
      ui: "确认窗右下「确认执行」",
      clicks: 1,
      dialogs: 0,
      note: "审批走 ai_inbox_approve → run_write，审计记一条 approved。",
    },
    {
      action: "再发起一次写入并点「拒绝」",
      ui: "确认窗「拒绝」",
      clicks: 1,
      dialogs: 0,
      note: "拒绝后节点不出现，待审项状态为 rejected。",
    },
  ],
  complexity: {
    clickTotal: 2,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "AI 写入在真正落库前必须有人在主界面看过对比并点确认；批准/拒绝都是单步。相比只在设置页列一坨原始 JSON，确认成本从「找到入口+读懂 JSON」降到「读两列差异」。",
  },
  async run(ctx) {
    await waitForHealth();
    const token = ctx.globalDb("SELECT value FROM settings WHERE key = 'mcp.token'")[0]?.value ?? "";
    if (!token) throw new Error("客户端未生成 MCP 令牌");
    const kb = ctx.db("SELECT id FROM knowledge_base LIMIT 1")[0];
    if (!kb) throw new Error("当前工作区没有知识库");

    const stamp = Date.now();
    const approvedTitle = `E2E MCP 批准 ${stamp}`;
    const rejectedTitle = `E2E MCP 拒绝 ${stamp}`;

    const pending = await callWriteTool(token, "doc_create", {
      knowledgeBaseId: kb.id,
      parentId: null,
      title: approvedTitle,
      markdown: "# MCP 写入\n\n第一段内容\n第二段内容",
      summary: "E2E：确认窗批准路径",
    });
    if (!pending.includes("pending_review")) {
      throw new Error(`doc_create 应进入待审，实际返回：${pending.slice(0, 200)}`);
    }

    await ctx.expectText("AI 写入待确认", { timeout: 10_000 });
    await ctx.expectText("变更对比", { timeout: 8_000 });
    await ctx.expectText("E2E：确认窗批准路径", { timeout: 8_000 });
    // 新建文档也要逐行摊开写进去的正文，只报「共 N 段」等于让人确认看不见的内容。
    await ctx.expectText("第一段内容", { timeout: 8_000 });
    await ctx.screenshot("mcp-review-approve");
    assert.equal(
      ctx.db("SELECT COUNT(*) AS count FROM node WHERE title = ?", [approvedTitle])[0].count,
      0,
      "确认前不应落库",
    );
    ctx.metrics.dialogs += 1;

    await ctx.press("确认执行");
    await ctx.expectGone("AI 写入待确认", { timeout: 10_000 });
    await ctx.waitForDb(
      "SELECT id FROM node WHERE title = ?",
      [approvedTitle],
      (rows) => rows.length === 1,
      { timeout: 15_000 },
    );
    await ctx.waitForDb(
      "SELECT outcome FROM ai_audit WHERE summary = 'E2E：确认窗批准路径' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].outcome === "approved",
      { timeout: 10_000 },
    );
    ctx.log("批准路径：待审 → 主界面对比 → 确认执行 → 节点与审计落库。");

    const pendingAgain = await callWriteTool(token, "doc_create", {
      knowledgeBaseId: kb.id,
      parentId: null,
      title: rejectedTitle,
      markdown: "# 不该出现的内容",
      summary: "E2E：确认窗拒绝路径",
    });
    if (!pendingAgain.includes("pending_review")) {
      throw new Error("第二次写入未进入待审");
    }
    await ctx.expectText("AI 写入待确认", { timeout: 10_000 });
    await ctx.press("拒绝");
    await ctx.expectGone("AI 写入待确认", { timeout: 10_000 });
    assert.equal(
      ctx.db("SELECT COUNT(*) AS count FROM node WHERE title = ?", [rejectedTitle])[0].count,
      0,
      "拒绝后不应落库",
    );
    await ctx.waitForDb(
      "SELECT status FROM ai_inbox WHERE summary = 'E2E：确认窗拒绝路径' ORDER BY created_at DESC LIMIT 1",
      [],
      (rows) => rows.length === 1 && rows[0].status === "rejected",
      { timeout: 10_000 },
    );
    await ctx.screenshot("mcp-review-rejected");
    ctx.log("拒绝路径：待审 → 拒绝 → 节点未创建，待审项标记 rejected。");
  },
};
