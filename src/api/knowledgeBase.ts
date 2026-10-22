/**
 * 知识库 IPC 封装：列表、新建、修改、删除（删除级联节点由 Rust 保证）。
 */

import { invokeCommand } from "@/api/client";
import type { KnowledgeBase } from "@/types/notebook";

/** Rust `KnowledgeBaseDto` 原始结构 */
interface KnowledgeBaseDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

/** 修改知识库参数；未提供的字段保持不变 */
export interface UpdateKnowledgeBaseParams {
  name?: string;
  description?: string;
}

/**
 * 列出当前工作区的知识库。
 * @returns 按排序号与创建时间升序的知识库数组
 * @example const kbs = await listKnowledgeBases();
 */
export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const dtos = await invokeCommand<KnowledgeBaseDto[]>("kb_list");
  return dtos.map(mapKnowledgeBase);
}

/**
 * 新建知识库并追加到末尾。
 * @param name 名称（1~80 字符）
 * @param description 描述（≤500 字符，可空）
 * @returns 新建的知识库
 * @example await createKnowledgeBase("产品灵感库", "交互灵感");
 */
export async function createKnowledgeBase(name: string, description: string): Promise<KnowledgeBase> {
  const dto = await invokeCommand<KnowledgeBaseDto>("kb_create", {
    input: { name, description },
  });
  return mapKnowledgeBase(dto);
}

/**
 * 修改知识库名称或描述。
 * @param id 知识库 id
 * @param params 需要修改的字段
 * @returns 更新后的知识库
 * @example await updateKnowledgeBase(kb.id, { name: "新名字" });
 */
export async function updateKnowledgeBase(
  id: string,
  params: UpdateKnowledgeBaseParams,
): Promise<KnowledgeBase> {
  const dto = await invokeCommand<KnowledgeBaseDto>("kb_update", {
    input: { id, name: params.name, description: params.description },
  });
  return mapKnowledgeBase(dto);
}

/**
 * 删除知识库并级联删除其所有节点。
 * @param id 知识库 id
 * @returns 被删除的节点数量
 * @example const { deletedNodes } = await deleteKnowledgeBase(kb.id);
 */
export async function deleteKnowledgeBase(id: string): Promise<{ deletedNodes: number }> {
  return invokeCommand<{ deletedNodes: number }>("kb_delete", { id });
}

/** DTO → 领域类型 */
function mapKnowledgeBase(dto: KnowledgeBaseDto): KnowledgeBase {
  return {
    id: dto.id,
    workspaceId: dto.workspaceId,
    name: dto.name,
    description: dto.description,
    docCount: dto.docCount,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
