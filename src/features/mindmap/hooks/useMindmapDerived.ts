/**
 * 思维导图的派生状态：搜索命中与同侧可成组的选择。
 */

import { useMemo } from "react";
import type { MindmapContent, MindmapLayout, MindmapTopic } from "@/types/mindmap";

/** 按文本/备注/标签搜索主题，最多返回 80 条。 */
export function useMindmapSearchResults(content: MindmapContent, search: string): MindmapTopic[] {
  return useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const found: MindmapTopic[] = [];
    const walk = (topic: MindmapTopic) => {
      if (
        `${topic.text} ${topic.note ?? ""} ${(topic.labels ?? []).join(" ")}`.toLowerCase().includes(query)
      ) {
        found.push(topic);
      }
      for (const child of topic.children ?? []) walk(child);
    };
    walk(content.sheet.root);
    for (const summary of content.summaries ?? []) walk(summary.topic);
    return found.slice(0, 80);
  }, [content.sheet.root, content.summaries, search]);
}

/** 从同父且同侧的选择中筛出可加外框/概要的组（至少 2 个）。 */
export function useMindmapGrouping(params: {
  content: MindmapContent;
  selectedId: string | null;
  selectionSet: string[];
  layoutNodes: MindmapLayout["nodes"];
}): string[] {
  const { content, selectedId, selectionSet, layoutNodes } = params;
  const siblingsOfSelected = useMemo(() => {
    if (!selectedId) return [] as string[];
    const walk = (topic: MindmapTopic): string[] | null => {
      for (const child of topic.children ?? []) {
        if (child.id === selectedId) return (topic.children ?? []).map((item) => item.id);
        const nested = walk(child);
        if (nested) return nested;
      }
      return null;
    };
    return walk(content.sheet.root) ?? [];
  }, [content.sheet.root, selectedId]);

  return useMemo(() => {
    const ids = selectionSet.filter((id) => siblingsOfSelected.includes(id));
    if (ids.length < 2) return [];
    const sideOf = (id: string) => layoutNodes.find((node) => node.id === id)?.side;
    const side = sideOf(ids[0]);
    const sameSide = ids.filter((id) => sideOf(id) === side);
    return sameSide.length >= 2 ? sameSide : [];
  }, [layoutNodes, selectionSet, siblingsOfSelected]);
}
