import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

export interface EditorContentBox {
  left: number;
  width: number;
}

/** 读取 `.tiptap` 内容盒的视口坐标，供自绘落点线使用。 */
export function measureEditorContentBox(editor: Editor): EditorContentBox {
  const dom = editor.view.dom;
  const rect = dom.getBoundingClientRect();
  const style = window.getComputedStyle(dom);
  const padLeft = Number.parseFloat(style.paddingLeft) || 0;
  const padRight = Number.parseFloat(style.paddingRight) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  return {
    left: rect.left + borderLeft + padLeft,
    width: Math.max(0, rect.width - borderLeft - borderRight - padLeft - padRight),
  };
}

/**
 * 把顶层块移动到 `insertPos`（删除前的位置）。
 *
 * `insertPos` 是当前文档中的插入点；删除源块后若插入点在其后方，需要减去源节点大小。
 * 源节点已变化或落回原位时不派发事务，避免无意义保存。
 */
export function moveTopLevelNode(
  editor: Editor,
  sourcePos: number,
  sourceNode: ProseMirrorNode,
  insertPos: number,
) {
  if (editor.isDestroyed) return;
  const state = editor.state;
  const currentNode = state.doc.nodeAt(sourcePos);
  if (!currentNode?.eq(sourceNode)) return;
  const mapped = insertPos > sourcePos ? insertPos - sourceNode.nodeSize : insertPos;
  if (mapped === sourcePos) return;
  const tr = state.tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
  tr.insert(mapped, sourceNode);
  const caret = Math.min(mapped + 1, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}
