import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentImageNodeView } from "../components/nodes/AttachmentImageNodeView";
import type { AttachmentImageAttrs, AttachmentNodeViewOptions } from "./attachmentTypes";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachmentImage: {
      /** 插入一个附件图片块。 */
      setAttachmentImage: (attrs: AttachmentImageAttrs) => ReturnType;
    };
  }
}

/**
 * 图片块：attachmentId + 展示元数据；NodeView 通过附件模块读取预览、缩放与对齐。
 * 不把 data URL 写进文档 JSON。
 */
export const AttachmentImage = Node.create<AttachmentNodeViewOptions>({
  name: "attachmentImage",
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
      attachmentId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes: AttachmentImageAttrs) =>
          attributes.attachmentId ? { "data-attachment-id": attributes.attachmentId } : {},
      },
      name: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-name") ?? "",
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-name": attributes.name }),
      },
      size: {
        default: 0,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-size") ?? 0),
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-size": String(attributes.size) }),
      },
      mime: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-mime") ?? "",
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-mime": attributes.mime }),
      },
      alt: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-alt") ?? "",
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-alt": attributes.alt }),
      },
      width: {
        default: 0,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-width") ?? 0),
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-width": String(attributes.width) }),
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute("data-align");
          return value === "center" || value === "right" ? value : "left";
        },
        renderHTML: (attributes: AttachmentImageAttrs) => ({ "data-align": attributes.align }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-attachment-image": "", class: "attachment-image-block" }, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setAttachmentImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageNodeView);
  },
});
