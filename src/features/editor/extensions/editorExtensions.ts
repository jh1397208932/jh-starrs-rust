/**
 * 编辑器扩展集合（全部为 Tiptap 官方 MIT 包，无 Pro/Cloud 依赖）。
 *
 * 控制条类交互不在扩展内渲染，统一由气泡/右键/Slash 菜单调用命令。
 */

import { mergeAttributes } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Color from "@tiptap/extension-color";
import Details, { DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Emoji, { type EmojiItem } from "@tiptap/extension-emoji";
import FileHandler from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import TableOfContents from "@tiptap/extension-table-of-contents";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import type { Editor, Extensions } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { t } from "@/lib/i18n";
import type { OutlineItem } from "../types";
import { AttachmentBlock } from "./attachmentBlock";
import { AttachmentImage } from "./attachmentImage";
import { BlockDragHighlight } from "./blockDragHighlight";
import { ClearMarksOnEnter } from "./clearMarksOnEnter";
import { BoardEmbed, MindmapEmbed } from "./embedBlock";
import { FindHighlight } from "./findHighlight";
import { UserKeymap } from "./userKeymap";

const lowlight = createLowlight(common);

/** 空 name 的 emoji 节点渲染为空，避免出现 `:null:`；保存时规范化会删除这类节点。 */
const SafeEmoji = Emoji.extend({
  renderText({ node }) {
    const name = node.attrs.name;
    if (typeof name !== "string" || !name.trim()) return "";
    const item = this.options.emojis.find((emoji) => emoji.name === name);
    return item?.emoji ?? `:${name}:`;
  },
  renderHTML({ HTMLAttributes, node }) {
    const name = node.attrs.name;
    const attributes = mergeAttributes(HTMLAttributes, this.options.HTMLAttributes, { "data-type": "emoji" });
    if (typeof name !== "string" || !name.trim()) return ["span", attributes];
    const item = this.options.emojis.find((emoji) => emoji.name === name);
    return ["span", attributes, item?.emoji ?? `:${name}:`];
  },
});

/** 按需保留的表情集，避免把整份 emoji 数据打进产物。 */
export const EDITOR_EMOJIS: EmojiItem[] = [
  { name: "smile", emoji: "😄", shortcodes: ["smile"], tags: ["happy"] },
  { name: "wink", emoji: "😉", shortcodes: ["wink"], tags: ["happy"] },
  { name: "heart", emoji: "❤️", shortcodes: ["heart"], tags: ["love"] },
  { name: "sparkles", emoji: "✨", shortcodes: ["sparkles"], tags: ["magic"] },
  { name: "rocket", emoji: "🚀", shortcodes: ["rocket"], tags: ["launch"] },
  { name: "tada", emoji: "🎉", shortcodes: ["tada"], tags: ["party"] },
  { name: "fire", emoji: "🔥", shortcodes: ["fire"], tags: ["hot"] },
  { name: "bulb", emoji: "💡", shortcodes: ["bulb"], tags: ["idea"] },
  { name: "book", emoji: "📖", shortcodes: ["book"], tags: ["read"] },
  { name: "check", emoji: "✅", shortcodes: ["check"], tags: ["done"] },
  { name: "eyes", emoji: "👀", shortcodes: ["eyes"], tags: ["look"] },
  { name: "coffee", emoji: "☕", shortcodes: ["coffee"], tags: ["break"] },
];

export interface EditorExtensionOptions {
  /** 大纲更新；同时带来源编辑器，供调用方过滤已被替换的旧实例。 */
  onOutline: (editor: Editor, items: OutlineItem[]) => void;
  onImageError: (message: string) => void;
  /** 粘贴/拖放的文件；由 DocEditor 上传到附件对象模块后插入图片/附件块。 */
  onFilesDropped: (editor: Editor, files: File[], pos?: number) => void;
}

/** 创建编辑器扩展；每次编辑器实例创建时调用一次。 */
export function createEditorExtensions({
  onOutline,
  onImageError,
  onFilesDropped,
}: EditorExtensionOptions): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      },
      // 官方 Dropcursor：拖拽时给出整行落点指示。
      dropcursor: { color: "var(--primary)", width: 3, class: "starris-drop-cursor" },
    }),
    ClearMarksOnEnter,
    BlockDragHighlight,
    UserKeymap,
    FindHighlight,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({
      allowBase64: true,
      resize: { enabled: true, minWidth: 120, minHeight: 80 },
    }),
    AttachmentImage.configure({ onError: onImageError }),
    AttachmentBlock.configure({ onError: onImageError }),
    BoardEmbed,
    MindmapEmbed,
    CodeBlockLowlight.configure({ lowlight }),
    SafeEmoji.configure({ emojis: EDITOR_EMOJIS }),
    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,
    TableOfContents.configure({
      onUpdate: function (this: { editor: Editor }, items) {
        onOutline(
          this.editor,
          items.map((item) => ({
            id: item.id,
            text: item.textContent,
            level: item.level,
            pos: item.pos,
          })),
        );
      },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => (node.type.name === "heading" ? t("标题") : t("开始写作…")),
    }),
    CharacterCount.configure({
      textCounter: (text) => text.replace(/\s/g, "").length,
    }),
    FileHandler.configure({
      consumePasteEvent: true,
      onPaste: (editor, files) => {
        if (files.length > 0) onFilesDropped(editor, files);
      },
      onDrop: (editor, files, pos) => {
        if (files.length > 0) onFilesDropped(editor, files, pos);
      },
    }),
  ];
}
