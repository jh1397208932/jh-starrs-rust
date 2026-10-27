/**
 * 导图分组类命令：外框/概要/关系线/自由主题。
 */

import { useCallback } from "react";
import type { MindmapContent } from "@/types/mindmap";
import { addBoundary, addFreeTopic, addRelationship, addSummary, createTopic } from "../utils/tree";

export interface GroupActionParams {
  content: MindmapContent;
  commit: (next: MindmapContent | null, mergeKey?: string | null) => void;
  selectedId: string | null;
  groupSelection: string[];
  parentIdOf: (childId: string) => string | null;
  labelSummary: string;
  labelFloating: string;
  clearSelection: () => void;
  setSelectedId: (id: string | null) => void;
  setSelectionSet: (updater: string[] | ((current: string[]) => string[])) => void;
  setEditingId: (id: string | null) => void;
}

/** 返回四个工具栏动作。 */
export function useMindmapGroupActions(params: GroupActionParams) {
  const {
    content,
    commit,
    selectedId,
    groupSelection,
    parentIdOf,
    labelSummary,
    labelFloating,
    clearSelection,
    setSelectedId,
    setSelectionSet,
    setEditingId,
  } = params;

  const addBoundaryForSelection = useCallback(() => {
    const parent = groupSelection[0] ? parentIdOf(groupSelection[0]) : null;
    if (!parent) return;
    commit(addBoundary(content, parent, [...groupSelection]));
  }, [commit, content, groupSelection, parentIdOf]);

  const addSummaryForSelection = useCallback(() => {
    const parent = groupSelection[0] ? parentIdOf(groupSelection[0]) : null;
    if (!parent) return;
    const summaryTopic = createTopic(labelSummary);
    commit(addSummary(content, parent, [...groupSelection], summaryTopic));
    setSelectedId(summaryTopic.id);
    setSelectionSet([]);
  }, [commit, content, groupSelection, labelSummary, parentIdOf, setSelectedId, setSelectionSet]);

  const addRelationForSelection = useCallback(() => {
    if (!selectedId) return;
    commit(addRelationship(content, content.sheet.root.id, selectedId));
    clearSelection();
  }, [clearSelection, commit, content, selectedId]);

  const addFreeTopicAtCanvas = useCallback(() => {
    const topic = createTopic(labelFloating);
    const offset = (content.freeTopics?.length ?? 0) * 40;
    commit(addFreeTopic(content, topic, { x: 120 + offset, y: -160 - offset }));
    setSelectedId(topic.id);
    setSelectionSet([topic.id]);
    setEditingId(topic.id);
  }, [commit, content, labelFloating, setEditingId, setSelectedId, setSelectionSet]);

  return { addBoundaryForSelection, addSummaryForSelection, addRelationForSelection, addFreeTopicAtCanvas };
}
