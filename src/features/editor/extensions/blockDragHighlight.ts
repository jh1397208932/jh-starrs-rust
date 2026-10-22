import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const blockDragHighlightKey = new PluginKey<DecorationSet>("blockDragHighlight");

/** 设置拖拽源块位置；传 null 清除。 */
export const BLOCK_DRAG_SOURCE_META = "blockDragSource";

/**
 * 拖拽源块淡化。
 *
 * 不能直接给 ProseMirror 节点加 class：视图会把它视为异常 DOM 并重绘，
 * 类名随即丢失。通过 Decoration 表达纯视觉状态，文档与保存数据不受影响。
 */
export const BlockDragHighlight = Extension.create({
  name: "blockDragHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockDragHighlightKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            const pos = tr.getMeta(BLOCK_DRAG_SOURCE_META) as number | null | undefined;
            if (pos === null) return DecorationSet.empty;
            if (typeof pos !== "number") return previous.map(tr.mapping, tr.doc);
            const node = tr.doc.nodeAt(pos);
            if (!node) return DecorationSet.empty;
            return DecorationSet.create(tr.doc, [
              Decoration.node(pos, pos + node.nodeSize, {
                class: "editor-block-drag-source",
              }),
            ]);
          },
        },
        props: {
          decorations(state) {
            return blockDragHighlightKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
