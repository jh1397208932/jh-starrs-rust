//! 模板库 API。

import { invokeCommand } from "@/api/client";
import { mapNode, type NodeDto } from "@/api/node";
import type {
  CreateFromTemplateParams,
  CreateFromTemplateResult,
  SaveTemplateParams,
  TemplateSummary,
} from "@/types/template";

/** 列出当前工作区模板。 */
export async function listTemplates(): Promise<TemplateSummary[]> {
  return invokeCommand<TemplateSummary[]>("template_list");
}

/** 保存当前文档/画板为模板。 */
export async function saveTemplate(params: SaveTemplateParams): Promise<TemplateSummary> {
  return invokeCommand<TemplateSummary>("template_save", {
    input: { nodeId: params.nodeId, name: params.name },
  });
}

/** 从模板创建节点。 */
export async function createFromTemplate(
  params: CreateFromTemplateParams,
): Promise<CreateFromTemplateResult> {
  const result = await invokeCommand<{ node: NodeDto }>("template_create_node", {
    input: {
      templateId: params.templateId,
      knowledgeBaseId: params.knowledgeBaseId,
      parentId: params.parentId ?? null,
      title: params.title,
    },
  });
  return { node: mapNode(result.node) };
}

/** 删除模板。 */
export async function deleteTemplate(id: string): Promise<void> {
  await invokeCommand("template_delete", { id });
}
