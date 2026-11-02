/**
 * 当前文档大纲的进程内共享状态：编辑器发布标题，工具栏订阅并跳转。
 *
 * 同一时刻只保留一个 owner（一个 DocEditor 实例）；旧实例的清理不会覆盖新实例。
 */

import type { Editor } from "@tiptap/react";
import { useSyncExternalStore } from "react";
import type { OutlineItem } from "./types";

interface OutlineSnapshot {
  items: OutlineItem[];
  editor: Editor | null;
}

const EMPTY: OutlineSnapshot = { items: [], editor: null };

let activeOwner: symbol | null = null;
let snapshot: OutlineSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

/** 编辑器就绪时认领大纲；后续同 owner 的发布才生效。 */
export function activateOutline(owner: symbol, editor: Editor) {
  activeOwner = owner;
  snapshot = { items: [], editor };
  emit();
}

/** 两份标题列表是否逐项一致（id/层级/文本/位置）。 */
function sameOutline(left: OutlineItem[], right: OutlineItem[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.id !== b.id || a.level !== b.level || a.text !== b.text || a.pos !== b.pos) return false;
  }
  return true;
}

/** 发布 TOC 扩展计算出的标题列表。 */
export function publishOutline(owner: symbol, items: OutlineItem[]) {
  if (owner !== activeOwner) return;
  // TOC 扩展每次文档事务都会回调；正文打字不改变标题时不要换引用，
  // 否则目录订阅方（页头大纲浮层）会跟着每个字符重渲染一次。
  if (sameOutline(snapshot.items, items)) return;
  snapshot = { items, editor: snapshot.editor };
  emit();
}

/** 卸载时释放；只有仍是当前 owner 才清空。 */
export function deactivateOutline(owner: symbol) {
  if (owner !== activeOwner) return;
  activeOwner = null;
  snapshot = EMPTY;
  emit();
}

/** 点击目录：把光标放到标题内并滚动到可视区域。 */
export function jumpToOutline(pos: number) {
  const editor = snapshot.editor;
  if (!editor || editor.isDestroyed) return;
  editor
    .chain()
    .focus()
    .setTextSelection(pos + 1)
    .scrollIntoView()
    .run();
}

/** 工具栏订阅当前文档大纲。 */
export function useEditorOutline() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
