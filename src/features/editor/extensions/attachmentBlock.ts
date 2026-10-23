import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentBlockNodeView } from "../components/nodes/AttachmentBlockNodeView";
import {
  type AttachmentBlockAttrs,
  type AttachmentNodeItem,
  type AttachmentNodeViewOptions,
  parseAttachmentItems,
} from "./attachmentTypes";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachmentBlock: {
      /** 插入一个附件块（卡片/长条）。 */
      setAttachmentBlock: (attrs: { items: AttachmentNodeItem[]; variant?: "grid" | "list" }) => ReturnType;
    };
  }
}

/**
 * 附件块：一个 atom 容器承载 0..N 个附件，NodeView 一次渲染卡片/长条。
 * items 只存 attachmentId + 名称/大小/MIME，不复制对象字节。
 */
export const AttachmentBlock = Node.create<AttachmentNodeViewOptions>({
  name: "attachmentBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addOptions() {
    return {
      onError: () => undefined,
    };
  },

  addAttributes() {
    return {
      items: {
        default: [],
        parseHTML: (element: HTMLElement) => parseAttachmentItems(element.getAttribute("data-items")),
        renderHTML: (attributes: AttachmentBlockAttrs) => ({
          "data-items": JSON.stringify(Array.isArray(attributes.items) ? attributes.items : []),
        }),
      },
      variant: {
        default: "grid",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-variant") === "list" ? "list" : "grid",
        renderHTML: (attributes: AttachmentBlockAttrs) => ({ "data-variant": attributes.variant }),
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("data-align");
          return value === "center" || value === "right" ? value : "left";
        },
        renderHTML: (attributes: AttachmentBlockAttrs) => ({ "data-align": attributes.align }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-attachment-block": "", class: "attachment-block" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setAttachmentBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              items: attrs.items,
              variant: attrs.variant ?? "grid",
              align: "left",
            },
          }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentBlockNodeView);
  },
});
