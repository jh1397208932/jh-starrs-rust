/**
 * MCP 客户端托管：服务随窗口运行、令牌鉴权、工具清单与设置页展示。
 *
 * 传输是本机 HTTP（E2E 固定端口 47822）；令牌写全局库，用例直接读取后模拟 agent 调用。
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
      // 启动尚未就绪，继续等待
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("客户端 MCP 服务未在 20s 内就绪");
}

async function rpc(id, method, params, token) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

export default {
  id: "28-mcp-host",
  title: "MCP · 客户端托管 · 令牌鉴权 · 工具清单",
  area: "AI 协作 / MCP",
  steps: [
    {
      action: "等待客户端托管 MCP 服务就绪",
      ui: "应用启动后自动监听 127.0.0.1（E2E 端口 47822）",
      clicks: 0,
      dialogs: 0,
      note: "MCP 是客户端能力：进程内 HTTP 服务，随窗口启停。",
    },
    {
      action: "无令牌请求被拒绝、正确令牌可握手并列出工具",
      ui: "HTTP POST /mcp",
      clicks: 0,
      dialogs: 0,
      note: "401 不执行任何工具；initialize/tools/list/tools/call 走现有 ai_service。",
    },
    {
      action: "设置 → AI 协作 展示 MCP 状态与凭据",
      ui: "更多 → 设置 → AI 协作 → MCP 服务",
      clicks: 3,
      dialogs: 1,
      note: "显示运行中、端点与令牌，并可按需停用。",
    },
  ],
  complexity: {
    clickTotal: 3,
    dialogs: 1,
    typingFields: 0,
    assessment:
      "MCP 不再是独立程序：随客户端启动的本机 HTTP 服务复用同一工作区连接与权限体系；agent 只需端点与令牌即可接入。",
  },
  async run(ctx) {
    await waitForHealth();

    const token = ctx.globalDb("SELECT value FROM settings WHERE key = 'mcp.token'")[0]?.value ?? "";
    if (!token) throw new Error("客户端未生成 MCP 令牌");

    const unauthorized = await rpc(1, "initialize", {}, null);
    if (unauthorized.status !== 401) {
      throw new Error(`无令牌请求应返回 401（实际 ${unauthorized.status}）`);
    }

    const init = await rpc(2, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e", version: "1" },
    }, token);
    if (init.payload?.result?.serverInfo?.name !== "starris-mcp") {
      throw new Error("initialize 未返回 serverInfo");
    }

    const list = await rpc(3, "tools/list", {}, token);
    const tools = list.payload?.result?.tools ?? [];
    if (tools.length < 21) throw new Error(`工具数量不足（实际 ${tools.length}）`);
    if (!tools.every((tool) => tool.inputSchema)) throw new Error("存在没有 inputSchema 的工具");

    const call = await rpc(4, "tools/call", { name: "kb_list", arguments: {} }, token);
    const text = call.payload?.result?.content?.[0]?.text ?? "";
    if (!text.includes("knowledgeBases")) throw new Error("kb_list 未返回工作区数据");

    // 设置页应展示托管状态与连接凭据
    await ctx.menu("更多 ⌘J", "设置");
    await ctx.press("AI 协作", { role: "AXRadioButton" });
    await ctx.expectText("MCP 服务", { timeout: 8000 });
    await ctx.expectText("运行中", { timeout: 8000 });
    await ctx.expectText("访问令牌", { timeout: 8000 });
    ctx.metrics.dialogs += 1;
    await ctx.press("完成");
    await ctx.expectText("更多 ⌘J", { timeout: 8000 });

    ctx.log(`MCP 托管校验通过：${tools.length} 个工具，令牌鉴权生效。`);
  },
};
