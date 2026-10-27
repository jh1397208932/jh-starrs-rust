import type { ChainedCommands } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Code,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  Link2Off,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Palette,
  Paperclip,
  Pilcrow,
  Quote,
  Rows3,
  Smile,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table2,
  Trash2,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "../constants";
import { EDITOR_EMOJIS } from "../extensions/editorExtensions";
import { normalizeLinkHref } from "../utils/link";
import { ColorSwatches } from "./ColorSwatches";

export interface EditorContextMenuProps {
  editor: Editor;
  position: { x: number; y: number };
  onClose: () => void;
  onInsertImage: () => void;
  onInsertAttachment: () => void;
  onError: (message: string) => void;
}

const itemCls = "editor-menu-item";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="editor-menu-label">{children}</div>;
}

interface ActionProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  destructive?: boolean;
}

function Action({ icon: Icon, label, onClick, active, destructive }: ActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-active={active === true}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(itemCls, destructive && "text-destructive hover:text-destructive")}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}

const BLOCK_ACTIONS: Array<{
  id: string;
  label: string;
  icon: LucideIcon;
  command: (chain: ChainedCommands) => ChainedCommands;
}> = [
  { id: "paragraph", label: "正文", icon: Pilcrow, command: (chain) => chain.setParagraph() },
  { id: "h1", label: "标题 H1", icon: Heading1, command: (chain) => chain.toggleHeading({ level: 1 }) },
  { id: "h2", label: "标题 H2", icon: Heading2, command: (chain) => chain.toggleHeading({ level: 2 }) },
  { id: "h3", label: "标题 H3", icon: Heading3, command: (chain) => chain.toggleHeading({ level: 3 }) },
  { id: "bullet", label: "无序列表", icon: List, command: (chain) => chain.toggleBulletList() },
  { id: "ordered", label: "有序列表", icon: ListOrdered, command: (chain) => chain.toggleOrderedList() },
  { id: "task", label: "任务列表", icon: ListChecks, command: (chain) => chain.toggleTaskList() },
  { id: "quote", label: "引用", icon: Quote, command: (chain) => chain.toggleBlockquote() },
  { id: "code", label: "代码块", icon: SquareCode, command: (chain) => chain.toggleCodeBlock() },
  { id: "details", label: "折叠块", icon: ChevronDown, command: (chain) => chain.setDetails() },
  { id: "divider", label: "分隔线", icon: Minus, command: (chain) => chain.setHorizontalRule() },
];

const ALIGN_ACTIONS: Array<{ id: string; label: string; icon: LucideIcon; value: string }> = [
  { id: "left", label: "左对齐", icon: AlignLeft, value: "left" },
  { id: "center", label: "居中", icon: AlignCenter, value: "center" },
  { id: "right", label: "右对齐", icon: AlignRight, value: "right" },
  { id: "justify", label: "两端对齐", icon: AlignJustify, value: "justify" },
];

/** 右键浮层：块类型、行内格式、颜色、高亮、对齐、插入、表格与链接。 */
export function EditorContextMenu({
  editor,
  position,
  onClose,
  onInsertImage,
  onInsertAttachment,
  onError,
}: EditorContextMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [linkValue, setLinkValue] = useState(
    () => (editor.getAttributes("link").href as string | undefined) ?? "",
  );
  const inTable = editor.isActive("table");
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? "";
  const currentHighlight = (editor.getAttributes("highlight").color as string | undefined) ?? "";
  const hasLink = editor.isActive("link");

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    if (showLink) linkInputRef.current?.focus();
  }, [showLink]);

  const run = (action: (chain: ChainedCommands) => ChainedCommands) => {
    action(editor.chain().focus()).run();
    onClose();
  };

  const applyLink = () => {
    const normalized = normalizeLinkHref(linkValue);
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      onClose();
      return;
    }
    if (!normalized) {
      onError(t("请输入有效链接"));
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    onClose();
  };

  const width = 300;
  const left = Math.max(8, Math.min(position.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(position.y, Math.max(8, window.innerHeight - 660)));

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("编辑器操作")}
      className="editor-float anim-pop-in fixed z-[60] w-[300px] overflow-hidden"
      style={{ left, top }}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input,form")) return;
        event.preventDefault();
      }}
    >
      <div className="editor-context-scroll p-1.5">
        <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
          <span className="text-[11.5px] font-semibold text-foreground">{t("编辑")}</span>
          <span className="text-[10.5px] text-muted-foreground">{t("Esc 关闭")}</span>
        </div>

        <div className="flex flex-wrap gap-0.5 px-1">
          {(
            [
              ["bold", t("加粗"), Bold, () => run((chain) => chain.toggleBold())],
              ["italic", t("斜体"), Italic, () => run((chain) => chain.toggleItalic())],
              ["underline", t("下划线"), Underline, () => run((chain) => chain.toggleUnderline())],
              ["strike", t("删除线"), Strikethrough, () => run((chain) => chain.toggleStrike())],
              ["code", t("行内代码"), Code, () => run((chain) => chain.toggleCode())],
              ["sub", t("下标"), Subscript, () => run((chain) => chain.toggleSubscript())],
              ["sup", t("上标"), Superscript, () => run((chain) => chain.toggleSuperscript())],
            ] as const
          ).map(([id, label, Icon, onClick]) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={editor.isActive(id === "sub" ? "subscript" : id === "sup" ? "superscript" : id)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClick}
              data-active={editor.isActive(id === "sub" ? "subscript" : id === "sup" ? "superscript" : id)}
              className="editor-bubble__button"
            >
              <Icon className="size-3.5" />
            </button>
          ))}
          <button
            type="button"
            title={t("清除格式")}
            aria-label={t("清除格式")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run((chain) => chain.unsetAllMarks().clearNodes())}
            className="flex h-7 cursor-default items-center rounded-md px-2 text-[11px] text-muted-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground"
          >
            {t("清除格式")}
          </button>
        </div>

        <div className="editor-menu-divider" />

        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Palette className="size-3" /> {t("文字颜色")}
          </span>
        </SectionLabel>
        <div className="px-2 pb-1">
          <ColorSwatches
            colors={TEXT_COLORS}
            mode="text"
            activeValue={currentColor}
            onPick={(value) => run((chain) => chain.setColor(value))}
            onClear={() => run((chain) => chain.unsetColor())}
          />
        </div>

        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Highlighter className="size-3" /> {t("高亮")}
          </span>
        </SectionLabel>
        <div className="px-2 pb-1">
          <ColorSwatches
            colors={HIGHLIGHT_COLORS}
            mode="highlight"
            activeValue={currentHighlight}
            onPick={(value) => run((chain) => chain.setHighlight({ color: value }))}
            onClear={() => run((chain) => chain.unsetHighlight())}
          />
        </div>

        <div className="editor-menu-divider" />

        <SectionLabel>{t("类型")}</SectionLabel>
        <div className="grid grid-cols-2 gap-0.5">
          {BLOCK_ACTIONS.map((action) => (
            <Action
              key={action.id}
              icon={action.icon}
              label={t(action.label)}
              onClick={() => run(action.command)}
            />
          ))}
        </div>

        <SectionLabel>{t("对齐")}</SectionLabel>
        <div className="flex gap-0.5 px-1">
          {ALIGN_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              title={t(action.label)}
              aria-label={t(action.label)}
              aria-pressed={editor.isActive({ textAlign: action.value })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run((chain) => chain.setTextAlign(action.value))}
              data-active={editor.isActive({ textAlign: action.value })}
              className="editor-bubble__button"
            >
              <action.icon className="size-3.5" />
            </button>
          ))}
        </div>

        <div className="editor-menu-divider" />

        <SectionLabel>{t("插入")}</SectionLabel>
        <Action
          icon={ImagePlus}
          label={t("图片")}
          onClick={() => {
            onClose();
            onInsertImage();
          }}
        />
        <Action
          icon={Paperclip}
          label={t("附件")}
          onClick={() => {
            onClose();
            onInsertAttachment();
          }}
        />
        <Action
          icon={Table2}
          label={t("表格 3×3")}
          onClick={() => run((chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
        />
        <Action
          icon={Link2}
          label={hasLink ? t("修改链接") : t("添加链接")}
          onClick={() => setShowLink((value) => !value)}
          active={showLink}
        />
        {hasLink && (
          <Action
            icon={Link2Off}
            label={t("移除链接")}
            onClick={() => run((chain) => chain.extendMarkRange("link").unsetLink())}
          />
        )}
        {showLink && (
          <form
            className="mt-1 flex items-center gap-1.5 px-1 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
          >
            <input
              ref={linkInputRef}
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="https://…"
              aria-label={t("链接地址")}
              onMouseDown={(event) => event.stopPropagation()}
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            />
            <button
              type="submit"
              className="h-7 cursor-default rounded-sm bg-accent px-2.5 text-[12px] font-medium text-accent-foreground ring-1 ring-primary/25 ring-inset transition-colors duration-150 ease-[var(--ease)] hover:bg-accent-foreground/15"
            >
              {t("应用")}
            </button>
          </form>
        )}

        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Smile className="size-3" /> {t("表情")}
          </span>
        </SectionLabel>
        <div className="grid grid-cols-6 gap-0.5 px-1 pb-1">
          {EDITOR_EMOJIS.map((emoji) => (
            <button
              key={emoji.name}
              type="button"
              title={emoji.name}
              aria-label={`插入表情 ${emoji.name}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run((chain) => chain.setEmoji(emoji.name))}
              className="grid h-7 cursor-default place-items-center rounded-sm text-[16px] transition-colors duration-150 ease-[var(--ease)] hover:bg-accent"
            >
              {emoji.emoji}
            </button>
          ))}
        </div>

        {inTable && (
          <>
            <div className="editor-menu-divider" />
            <SectionLabel>{t("表格")}</SectionLabel>
            <div className="grid grid-cols-2 gap-0.5">
              <Action
                icon={Rows3}
                label={t("上方加行")}
                onClick={() => run((chain) => chain.addRowBefore())}
              />
              <Action
                icon={Rows3}
                label={t("下方加行")}
                onClick={() => run((chain) => chain.addRowAfter())}
              />
              <Action
                icon={Columns3}
                label={t("左侧加列")}
                onClick={() => run((chain) => chain.addColumnBefore())}
              />
              <Action
                icon={Columns3}
                label={t("右侧加列")}
                onClick={() => run((chain) => chain.addColumnAfter())}
              />
              <Action icon={Rows3} label={t("删除行")} onClick={() => run((chain) => chain.deleteRow())} />
              <Action
                icon={Columns3}
                label={t("删除列")}
                onClick={() => run((chain) => chain.deleteColumn())}
              />
              <Action
                icon={Table2}
                label={t("切换表头")}
                onClick={() => run((chain) => chain.toggleHeaderRow())}
              />
              <Action
                icon={Trash2}
                label={t("删除表格")}
                destructive
                onClick={() => run((chain) => chain.deleteTable())}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
