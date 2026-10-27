import { useState } from "react";
import type { MindmapContent } from "@/types/mindmap";
import { addChild, createTopic, expandAncestors, removeTopic, updateTopic } from "../utils/tree";
import { MindmapOutline } from "./MindmapOutline";

export interface MindmapOutlinePanelProps {
  content: MindmapContent;
  selectedId: string | null;
  onClose: () => void;
  onSelectionChange: (id: string) => void;
  focusTopic: (id: string) => void;
  commit: (next: MindmapContent | null, mergeKey?: string | null) => void;
  setSelectedId: (id: string | null) => void;
}

/** 大纲抽屉：行内编辑/增删都回到同一棵树，保证撤销与画布一致。 */
export function MindmapOutlinePanel({
  content,
  selectedId,
  onClose,
  onSelectionChange,
  focusTopic,
  commit,
  setSelectedId,
}: MindmapOutlinePanelProps) {
  // 编辑态留在大纲内：新建子主题后直接进入行内输入，不要求再双击一次。
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <MindmapOutline
      root={content.sheet.root}
      selectedId={selectedId}
      editingId={editingId}
      setEditingId={setEditingId}
      onSelect={onSelectionChange}
      onNavigate={(id) => {
        commit(expandAncestors(content, id));
        setSelectedId(id);
        focusTopic(id);
      }}
      onUpdateText={(id, text) =>
        commit(
          updateTopic(content, id, (topic) => ({ ...topic, text })),
          `outline:${id}`,
        )
      }
      onAddChild={(parentId) => {
        const topic = createTopic("");
        commit(addChild(content, parentId, topic));
        setSelectedId(topic.id);
        setEditingId(topic.id);
      }}
      onDelete={(id) => {
        const next = removeTopic(content, id);
        if (next) commit(next);
      }}
      onClose={onClose}
    />
  );
}
