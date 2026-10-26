/** 模板库领域类型。 */

import type { NodeItem } from "./notebook";

export type TemplateKind = "doc" | "board";

export interface TemplateSummary {
  id: string;
  name: string;
  kind: TemplateKind;
  createdAt: number;
}

export interface SaveTemplateParams {
  nodeId: string;
  name: string;
}

export interface CreateFromTemplateParams {
  templateId: string;
  knowledgeBaseId: string;
  parentId?: string | null;
  title: string;
}

export interface CreateFromTemplateResult {
  node: NodeItem;
}
