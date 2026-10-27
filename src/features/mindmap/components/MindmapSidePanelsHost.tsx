import type {
  MindmapBoundary,
  MindmapContent,
  MindmapRelationship,
  MindmapSummary,
  MindmapTopic,
} from "@/types/mindmap";
import {
  removeBoundary,
  removeRelationship,
  removeSummary,
  updateBoundary,
  updateRelationship,
  updateTopic,
} from "../utils/tree";
import { MindmapInspector } from "./MindmapInspector";
import { MindmapFrameEditor, MindmapRelationshipEditor } from "./MindmapSidePanels";

export interface MindmapSidePanelsHostProps {
  content: MindmapContent;
  relationship: MindmapRelationship | null;
  frame: MindmapBoundary | MindmapSummary | null;
  frameColor?: string;
  topic: MindmapTopic | null;
  commit: (next: MindmapContent | null, mergeKey?: string | null) => void;
  clearSelection: () => void;
  onUploadImage: (file: File) => void;
}

/** 右侧面板路由：关系线 / 外框概要 / 主题检查器，三者互斥。 */
export function MindmapSidePanelsHost({
  content,
  relationship,
  frame,
  frameColor,
  topic,
  commit,
  clearSelection,
  onUploadImage,
}: MindmapSidePanelsHostProps) {
  if (relationship) {
    return (
      <MindmapRelationshipEditor
        relationship={relationship}
        onChange={(patch) => commit(updateRelationship(content, relationship.id, patch))}
        onDelete={() => {
          commit(removeRelationship(content, relationship.id));
          clearSelection();
        }}
      />
    );
  }
  if (frame) {
    return (
      <MindmapFrameEditor
        label={"topic" in frame ? undefined : frame.label}
        color={frameColor}
        isSummary={"topic" in frame}
        onLabel={(label) => {
          if ("topic" in frame) return;
          commit(updateBoundary(content, frame.id, { label }));
        }}
        onColor={(color) => {
          if ("topic" in frame) return;
          commit(updateBoundary(content, frame.id, { color }));
        }}
        onDelete={() => {
          commit("topic" in frame ? removeSummary(content, frame.id) : removeBoundary(content, frame.id));
          clearSelection();
        }}
      />
    );
  }
  if (!topic) return null;
  return (
    <MindmapInspector
      topic={topic}
      onChange={(patch, field) =>
        commit(
          updateTopic(content, topic.id, (current) => ({ ...current, ...patch })),
          `inspector:${topic.id}:${field}`,
        )
      }
      onImage={async (file) => onUploadImage(file)}
    />
  );
}
