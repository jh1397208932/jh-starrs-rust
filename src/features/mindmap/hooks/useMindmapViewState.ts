/**
 * 思维导图页面状态：加载、撤销历史、选择、派生几何与持久化装配。
 *
 * 页面组件只负责组合画布与面板；这里集中所有会影响渲染的状态与副作用，
 * 方便单独推演生命周期（例如加载后重置历史、只依赖稳定回调避免无限循环）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MindmapBoundary,
  MindmapContent,
  MindmapFile,
  MindmapRelationship,
  MindmapSummary,
} from "@/types/mindmap";
import { layoutMindmap } from "../utils/layout";
import { clearMeasureCache } from "../utils/measure";
import { findTopicInContent, moveUnder, toggleCollapsed, updateTopic } from "../utils/tree";
import { useMindmapGrouping, useMindmapSearchResults } from "./useMindmapDerived";
import { useMindmapHistory } from "./useMindmapHistory";
import { useMindmapPersistence } from "./useMindmapPersistence";

export interface MindmapViewStateParams {
  nodeId: string;
  onSaved: (updatedAt: number) => void;
  onError: (message: string) => void;
}

/** 组合页面所需的状态与派生值。 */
export function useMindmapViewState({ nodeId, onSaved, onError }: MindmapViewStateParams) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionSet, setSelectionSet] = useState<string[]>([]);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusTarget, setFocusTarget] = useState<{ id: string; token: number } | null>(null);

  const persistence = useMindmapPersistence({
    nodeId,
    onSaved: (updatedAt) => onSaved(updatedAt),
    onError,
  });
  // 历史层负责把每次内容变化（含撤销/重做）交给持久化层，避免撤销后只改内存。
  const history = useMindmapHistory(
    {
      schemaVersion: 2,
      sheet: {
        id: "sheet-loading",
        structure: "balanced",
        theme: "auto",
        root: { id: "topic-loading", text: "", children: [] },
      },
    },
    (content) => persistence.onContentChange(content),
  );
  const contentRef = useRef(history.content);
  contentRef.current = history.content;

  const resetContent = history.reset;
  useEffect(() => {
    if (!persistence.initial) return;
    // 只依赖稳定的 reset 回调与 initial 状态：history 对象每次渲染都是新的，
    // 把它放进依赖曾导致 reset → setState → 重渲染 → 再 reset 的无限循环白屏。
    resetContent({ ...persistence.initial.content, schemaVersion: 2 });
    setSelectedId(persistence.initial.content.sheet.root.id);
    setSelectionSet([]);
    clearMeasureCache();
  }, [persistence.initial, resetContent]);

  const images = useMemo(() => {
    const map = new Map<string, MindmapFile>();
    for (const file of persistence.initial?.images ?? []) map.set(file.id, file);
    return map;
  }, [persistence.initial]);

  const layout = useMemo(() => layoutMindmap(history.content), [history.content]);
  const focusTopic = useCallback((id: string) => {
    setFocusTarget((current) => ({ id, token: (current?.token ?? 0) + 1 }));
  }, []);

  const commit = useCallback(
    (next: MindmapContent | null, mergeKey: string | null = null) => {
      if (!next) return;
      history.apply(() => ({ ...next, schemaVersion: 2 }), mergeKey);
    },
    [history],
  );

  const selectedTopic = selectedId ? findTopicInContent(history.content, selectedId) : null;
  const groupSelection = useMindmapGrouping({
    content: history.content,
    selectedId,
    selectionSet,
    layoutNodes: layout.nodes,
  });
  const results = useMindmapSearchResults(history.content, search);

  const clearSelection = useCallback(() => {
    setSelectedRelationshipId(null);
    setSelectedFrameId(null);
  }, []);

  const onCommitText = useCallback(
    (id: string, text: string) => {
      setEditingId(null);
      commit(updateTopic(history.content, id, (topic) => ({ ...topic, text })));
    },
    [commit, history.content],
  );
  const onMoveUnder = useCallback(
    (sourceId: string, targetId: string) => commit(moveUnder(history.content, sourceId, targetId)),
    [commit, history.content],
  );
  const onToggleCollapsed = useCallback(
    (id: string) => commit(toggleCollapsed(history.content, id)),
    [commit, history.content],
  );

  const selectedRelationship: MindmapRelationship | null = selectedRelationshipId
    ? ((history.content.relationships ?? []).find((item) => item.id === selectedRelationshipId) ?? null)
    : null;
  const selectedFrame: MindmapBoundary | MindmapSummary | null = selectedFrameId
    ? selectedFrameId.startsWith("frame:bd-")
      ? ((history.content.boundaries ?? []).find(
          (item) => item.id === selectedFrameId.slice("frame:".length),
        ) ?? null)
      : ((history.content.summaries ?? []).find(
          (item) => item.id === selectedFrameId.slice("frame:".length),
        ) ?? null)
    : null;
  const selectedFrameColor = selectedFrame && "color" in selectedFrame ? selectedFrame.color : undefined;

  return {
    selectedId,
    setSelectedId,
    selectionSet,
    setSelectionSet,
    selectedRelationshipId,
    setSelectedRelationshipId,
    selectedFrameId,
    setSelectedFrameId,
    editingId,
    setEditingId,
    searchOpen,
    setSearchOpen,
    outlineOpen,
    setOutlineOpen,
    search,
    setSearch,
    focusTarget,
    focusTopic,
    history,
    persistence,
    images,
    layout,
    commit,
    selectedTopic,
    selectedRelationship,
    selectedFrame,
    selectedFrameColor,
    groupSelection,
    results,
    clearSelection,
    onCommitText,
    onMoveUnder,
    onToggleCollapsed,
  };
}
