/**
 * 思维导图的树命令与快捷键处理器：新增、删除、撤销、同级移动与方向导航。
 *
 * 把状态编排集中在 hook 里，页面组件只负责组合画布与面板。
 */

import { useCallback, useMemo } from "react";
import type { MindmapContent, MindmapLayout } from "@/types/mindmap";
import { pickDirectionalNode } from "../utils/navigation";
import {
  addChild,
  addSibling,
  cloneTopic,
  createTopic,
  demoteTopic,
  findTopicInContent,
  moveSibling,
  promoteTopic,
  removeFreeTopic,
  removeSummaryOfTopic,
  removeTopic,
  toggleCollapsed,
} from "../utils/tree";
import type { MindmapShortcutHandlers } from "./useMindmapKeymap";

export interface MindmapCommandParams {
  content: MindmapContent;
  rootId: string;
  selectedId: string | null;
  layoutNodes: MindmapLayout["nodes"];
  commit: (next: MindmapContent | null, mergeKey?: string | null) => void;
  historyUndo: () => void;
  historyRedo: () => void;
  flush: () => Promise<boolean>;
  focusTopic: (id: string) => void;
  clearSelection: () => void;
  setSelectedId: (id: string | null) => void;
  setSelectionSet: (updater: string[] | ((current: string[]) => string[])) => void;
  setEditingId: (id: string | null) => void;
  setSearchOpen: (open: boolean) => void;
}

/** 组装树命令；返回值交给画布/工具栏与快捷键层复用。 */
export function useMindmapCommands(params: MindmapCommandParams) {
  const {
    content,
    rootId,
    selectedId,
    layoutNodes,
    commit,
    historyUndo,
    historyRedo,
    flush,
    focusTopic,
    clearSelection,
    setSelectedId,
    setSelectionSet,
    setEditingId,
    setSearchOpen,
  } = params;

  const add = useCallback(
    (kind: "child" | "sibling") => {
      if (!selectedId) return;
      const topic = createTopic("");
      const next =
        kind === "child" ? addChild(content, selectedId, topic) : addSibling(content, selectedId, topic);
      if (!next) return;
      commit(next);
      setSelectedId(topic.id);
      setSelectionSet([topic.id]);
      setEditingId(topic.id);
    },
    [commit, content, selectedId, setEditingId, setSelectedId, setSelectionSet],
  );

  const navigateTo = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!selectedId) {
        setSelectedId(rootId);
        return;
      }
      const next = pickDirectionalNode(layoutNodes, selectedId, direction);
      if (!next) return;
      setSelectedId(next.id);
      focusTopic(next.id);
    },
    [focusTopic, layoutNodes, rootId, selectedId, setSelectedId],
  );

  const handlers = useMemo<MindmapShortcutHandlers>(
    () => ({
      "mindmap.addChild": () => add("child"),
      "mindmap.addSibling": () => add("sibling"),
      "mindmap.edit": () => selectedId && setEditingId(selectedId),
      "mindmap.delete": () => {
        if (!selectedId || selectedId === rootId) return;
        const next =
          removeTopic(content, selectedId) ??
          removeFreeTopic(content, selectedId) ??
          removeSummaryOfTopic(content, selectedId);
        if (!next) return;
        commit(next);
        setSelectedId(rootId);
        setSelectionSet([]);
        clearSelection();
      },
      "mindmap.toggle": () => {
        if (!selectedId) return;
        commit(toggleCollapsed(content, selectedId));
      },
      "mindmap.undo": historyUndo,
      "mindmap.redo": historyRedo,
      "mindmap.search": () => setSearchOpen(true),
      "mindmap.duplicate": () => {
        if (!selectedId) return;
        const source = findTopicInContent(content, selectedId);
        if (!source || source.id === rootId) return;
        commit(addSibling(content, selectedId, cloneTopic(source)));
      },
      "mindmap.moveUp": () => selectedId && commit(moveSibling(content, selectedId, -1)),
      "mindmap.moveDown": () => selectedId && commit(moveSibling(content, selectedId, 1)),
      "mindmap.promote": () => selectedId && commit(promoteTopic(content, selectedId)),
      "mindmap.demote": () => selectedId && commit(demoteTopic(content, selectedId)),
      "mindmap.navigateUp": () => navigateTo("up"),
      "mindmap.navigateDown": () => navigateTo("down"),
      "mindmap.navigateLeft": () => navigateTo("left"),
      "mindmap.navigateRight": () => navigateTo("right"),
      "mindmap.save": () => void flush(),
    }),
    [
      add,
      clearSelection,
      commit,
      content,
      flush,
      historyRedo,
      historyUndo,
      navigateTo,
      rootId,
      selectedId,
      setEditingId,
      setSearchOpen,
      setSelectedId,
      setSelectionSet,
    ],
  );

  return { add, navigateTo, handlers };
}
