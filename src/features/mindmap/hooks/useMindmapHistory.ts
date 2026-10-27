/**
 * 思维导图撤销/重做。
 *
 * 保存内容快照而不是坐标，限制为 100 步且累计不超过 20 MB，避免大图把内存吃满。
 * 同一个 mergeKey 的连续改动（例如逐字输入备注）只占一格历史，撤销一次即回到整段修改之前。
 * 每次内容真正变化（apply/undo/redo）都会回调 `onPersist`，避免撤销后的状态只留在内存里。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MindmapContent, MindmapTopic } from "@/types/mindmap";

const MAX_ENTRIES = 100;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

type HistoryKind = "init" | "apply" | "undo" | "redo" | "reset";

interface HistoryState {
  past: MindmapContent[];
  pastBytes: number;
  present: MindmapContent;
  future: MindmapContent[];
  mergeKey: string | null;
  kind: HistoryKind;
}

/** 管理导图编辑历史。 */
export function useMindmapHistory(initial: MindmapContent, onPersist?: (content: MindmapContent) => void) {
  const [state, setState] = useState<HistoryState>({
    past: [],
    pastBytes: 0,
    present: initial,
    future: [],
    mergeKey: null,
    kind: "init",
  });

  const persistRef = useRef(onPersist);
  persistRef.current = onPersist;
  const lastPersistedRef = useRef<MindmapContent | null>(null);
  useEffect(() => {
    if (state.kind === "init" || state.kind === "reset") return;
    if (lastPersistedRef.current === state.present) return;
    lastPersistedRef.current = state.present;
    persistRef.current?.(state.present);
  }, [state]);

  const reset = useCallback((content: MindmapContent) => {
    setState({
      past: [],
      pastBytes: 0,
      present: content,
      future: [],
      mergeKey: null,
      kind: "reset",
    });
  }, []);

  const apply = useCallback(
    (updater: (current: MindmapContent) => MindmapContent | null, mergeKey: string | null = null) => {
      setState((current) => {
        const next = updater(current.present);
        if (!next || next === current.present) return current;
        const merging = mergeKey !== null && current.mergeKey === mergeKey;
        let past = current.past;
        let pastBytes = current.pastBytes;
        if (!merging) {
          past = [...past, current.present];
          pastBytes += estimateContentBytes(current.present);
        }
        while (past.length > 0 && (past.length > MAX_ENTRIES || pastBytes > MAX_TOTAL_BYTES)) {
          const [removed, ...rest] = past;
          past = rest;
          pastBytes = Math.max(0, pastBytes - estimateContentBytes(removed));
        }
        return { past, pastBytes, present: next, future: [], mergeKey, kind: "apply" };
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setState((current) => {
      const previous = current.past[current.past.length - 1];
      if (!previous) return current;
      return {
        past: current.past.slice(0, -1),
        pastBytes: Math.max(0, current.pastBytes - estimateContentBytes(previous)),
        present: previous,
        future: [current.present, ...current.future],
        mergeKey: null,
        kind: "undo",
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const next = current.future[0];
      if (!next) return current;
      return {
        past: [...current.past, current.present],
        pastBytes: current.pastBytes + estimateContentBytes(current.present),
        present: next,
        future: current.future.slice(1),
        mergeKey: null,
        kind: "redo",
      };
    });
  }, []);

  return {
    content: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    apply,
    undo,
    redo,
    reset,
  };
}

/** 只遍历一次树、不分配字符串的体积估算，用于历史容量上限。 */
function estimateContentBytes(content: MindmapContent): number {
  let bytes = 0;
  const walk = (topic: MindmapTopic) => {
    bytes += 120 + topic.id.length + topic.text.length;
    bytes += topic.note?.length ?? 0;
    bytes += topic.link?.length ?? 0;
    for (const label of topic.labels ?? []) bytes += label.length + 8;
    for (const marker of topic.markers ?? []) bytes += marker.length + 8;
    for (const sticker of topic.stickers ?? []) bytes += sticker.length + 8;
    if (topic.image) bytes += topic.image.objectId.length + 40;
    for (const child of topic.children ?? []) walk(child);
  };
  walk(content.sheet.root);
  for (const free of content.freeTopics ?? []) walk(free);
  for (const summary of content.summaries ?? []) walk(summary.topic);
  bytes += (content.relationships?.length ?? 0) * 80;
  bytes += (content.boundaries?.length ?? 0) * 60;
  return bytes;
}
