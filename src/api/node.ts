/**
 * 文件树节点 IPC 封装：树查询、CRUD 与拖拽移动。
 * Rust 返回的 `type` 数字在此映射为前端 `kind` 字面量。
 */

import { ApiError, invokeCommand } from "@/api/client";
import {
  NODE_KIND_BY_TYPE,
  NODE_TYPE_BY_KIND,
  type NodeItem,
  type NodeKind,
  type NodeType,
} from "@/types/notebook";

/** Rust `NodeDto` 原始结构 */
export interface NodeDto {
  id: string;
  knowledgeBaseId: string;
  parentId: string | null;
  type: number;
  title: string;
  level: number;
  path: string;
  sortOrder: number;
  starred: boolean;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 新建节点参数 */
export interface CreateNodeParams {
  /** 所属知识库 */
  knowledgeBaseId: string;
  /** 父节点；根节点传 null */
  parentId: string | null;
  /** 节点类型；文件夹才允许有子级 */
  kind: NodeKind;
  /** 名称（不能含 / 或 \） */
  title: string;
}

/** 修改节点参数；未提供的字段保持不变 */
export interface UpdateNodeParams {
  title?: string;
  starred?: boolean;
}

/**
 * 读取指定知识库的完整平表树。
 * @param knowledgeBaseId 知识库 id
 * @returns 节点数组（未组树）
 * @example const nodes = await listNodes(currentKb.id);
 */
export async function listNodes(knowledgeBaseId: string): Promise<NodeItem[]> {
  const dtos = await invokeCommand<NodeDto[]>("node_list", { knowledgeBaseId });
  return dtos.map(mapNode);
}

/**
 * 新建节点。
 * @param params 知识库、父级、类型与名称
 * @returns 新建节点
 * @example await createNode({ knowledgeBaseId, parentId: null, kind: "folder", title: "设计" });
 */
export async function createNode(params: CreateNodeParams): Promise<NodeItem> {
  const dto = await invokeCommand<NodeDto>("node_create", {
    input: {
      knowledgeBaseId: params.knowledgeBaseId,
      parentId: params.parentId,
      type: NODE_TYPE_BY_KIND[params.kind],
      title: params.title,
    },
  });
  return mapNode(dto);
}

/**
 * 修改节点名称或收藏状态。
 * @param id 节点 id
 * @param params 需要修改的字段
 * @returns 更新后的节点
 * @example await updateNode(node.id, { title: "新标题" });
 */
export async function updateNode(id: string, params: UpdateNodeParams): Promise<NodeItem> {
  const dto = await invokeCommand<NodeDto>("node_update", {
    input: { id, title: params.title, starred: params.starred },
  });
  return mapNode(dto);
}

/**
 * 递归删除节点（文件夹连同全部后代）。
 * @param id 节点 id
 * @returns 含自身在内的删除数量
 * @example await deleteNode(folder.id);
 */
export async function deleteNode(id: string): Promise<{ deletedCount: number }> {
  return invokeCommand<{ deletedCount: number }>("node_delete", { id });
}

/**
 * 拖动移动节点：成为目标文件夹子级，或插入同级指定位置。
 * @param id 被移动节点 id
 * @param parentId 目标父级；根级传 null
 * @param index 目标同级组中的插入位置（0 起）
 * @returns 该知识库移动后的完整节点数组
 * @example await moveNode(node.id, folder.id, 0);
 */
export async function moveNode(id: string, parentId: string | null, index: number): Promise<NodeItem[]> {
  const dtos = await invokeCommand<NodeDto[]>("node_move", {
    input: { id, parentId, index },
  });
  return dtos.map(mapNode);
}

/** DTO → 领域类型；未知类型视为协议错误 */
export function mapNode(dto: NodeDto): NodeItem {
  const kind = NODE_KIND_BY_TYPE[dto.type as NodeType];
  if (!kind) {
    throw new ApiError("node_list", "此内容类型不受支持");
  }
  return {
    id: dto.id,
    kbId: dto.knowledgeBaseId,
    parentId: dto.parentId,
    title: dto.title,
    kind,
    level: dto.level,
    path: dto.path,
    sortOrder: dto.sortOrder,
    starred: dto.starred,
    wordCount: dto.wordCount,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
