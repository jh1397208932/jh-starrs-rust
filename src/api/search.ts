//! 工作区检索 API。

import { invokeCommand } from "@/api/client";
import type { NetworkItem, NodeNetwork, SearchHit, SearchNodesParams } from "@/types/search";

/**
 * 搜索当前知识库的标题与文档正文。
 * @param params 查询、知识库 id 与可选条数
 * @returns 按相关度/更新时间排序的结果
 * @example await searchNodes({ query: "会议", knowledgeBaseId: kb.id });
 */
export async function searchNodes(params: SearchNodesParams): Promise<SearchHit[]> {
  return invokeCommand<SearchHit[]>("search_nodes", {
    input: {
      query: params.query,
      knowledgeBaseId: params.knowledgeBaseId,
      limit: params.limit ?? 20,
    },
  });
}

/**
 * 读取节点的反向链接与相关推荐。
 * @param nodeId 当前节点 id
 * @returns 正文提到标题的文档与主题相近的文档
 * @example const { backlinks, related } = await getNodeNetwork(node.id);
 */
export async function getNodeNetwork(nodeId: string): Promise<NodeNetwork> {
  const network = await invokeCommand<{
    backlinks: NetworkItem[];
    related: NetworkItem[];
  }>("node_network", { nodeId });
  return network;
}
