/**
 * 工作区检索 IPC 契约。
 */

import type { NodeType } from "./notebook";

/** 搜索入参；空 query 表示最近更新。 */
export interface SearchNodesParams {
  query: string;
  knowledgeBaseId: string;
  limit?: number;
}

/** 单条搜索结果。 */
export interface SearchHit {
  nodeId: string;
  title: string;
  kbId: string;
  kbName: string;
  nodeType: NodeType;
  snippet: string;
  updatedAt: number;
}

/** 知识网络条目。 */
export interface NetworkItem {
  id: string;
  title: string;
  kbName: string;
  nodeType: NodeType;
}

/** 当前节点的反向链接与相关推荐。 */
export interface NodeNetwork {
  backlinks: NetworkItem[];
  related: NetworkItem[];
}
