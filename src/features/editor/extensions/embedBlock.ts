/**
 * 文档内嵌块：画板图 / 思维导图预览。
 *
 * 只存源节点 id 与标题，不复制源数据；图片由预览命令按 id 取。
 */

import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BoardEmbedNodeView, MindmapEmbedNodeView } from "../components/nodes/EmbedPreviewNodeView";

export interface EmbedAttrs {
  nodeId: string;
  title: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embedBlock: {
      /** 插入画板预览块。 */
      setBoardEmbed: (attrs: EmbedAttrs) => ReturnType;
      /** 插入思维导图预览块。 */
      setMindmapEmbed: (attrs: EmbedAttrs) => ReturnType;
    };
  }
}

const embedAttributes = {
  nodeId: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-node-id") ?? "",
    renderHTML: (attributes: EmbedAttrs) => ({ "data-node-id": attributes.nodeId }),
  },
  title: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-title") ?? "",
    renderHTML: (attributes: EmbedAttrs) => ({ "data-title": attributes.title }),
  },
};

/** 画板内嵌块。 */
export const BoardEmbed = Node.create({
  name: "boardEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes: () => embedAttributes,

  parseHTML() {
    return [{ tag: "figure[data-board-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes({ "data-board-embed": "", class: "embed-preview-block" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setBoardEmbed:
        (attrs: EmbedAttrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { nodeId: attrs.nodeId, title: attrs.title },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(BoardEmbedNodeView);
  },
});

/** 思维导图内嵌块。 */
export const MindmapEmbed = Node.create({
  name: "mindmapEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes: () => embedAttributes,

  parseHTML() {
    return [{ tag: "figure[data-mindmap-embed]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      mergeAttributes({ "data-mindmap-embed": "", class: "embed-preview-block" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setMindmapEmbed:
        (attrs: EmbedAttrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { nodeId: attrs.nodeId, title: attrs.title },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MindmapEmbedNodeView);
  },
});
