import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code,
  Eraser,
  Highlighter,
  Italic,
  Link2,
  Palette,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "../constants";
import { normalizeLinkHref } from "../utils/link";
import { ColorSwatches } from "./ColorSwatches";

export interface EditorBubbleMenuProps {
  editor: Editor;
  onError: (message: string) => void;
}

type Panel = "color" | "highlight" | "link" | null;

/** 气泡按钮：保持选区焦点，按下不抢焦点。 */
function BubbleButton({
  label,
  active,
  expanded,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  expanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      aria-expanded={expanded}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      data-active={active === true}
      className="editor-bubble__button"
    >
      {children}
    </button>
  );
}

/** 选区气泡菜单：行内样式、颜色、高亮、链接与清除格式。 */
export function EditorBubbleMenu({ editor, onError }: EditorBubbleMenuProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [linkValue, setLinkValue] = useState("");
  const linkInputRef = useRef<HTMLInputElement | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      subscript: current.isActive("subscript"),
      superscript: current.isActive("superscript"),
      link: current.isActive("link"),
      href: (current.getAttributes("link").href as string | undefined) ?? "",
      color: (current.getAttributes("textStyle").color as string | undefined) ?? "",
      highlight: (current.getAttributes("highlight").color as string | undefined) ?? "",
    }),
  });

  useEffect(() => {
    if (panel === "link") linkInputRef.current?.focus();
  }, [panel]);

  useEffect(() => {
    if (panel !== "link") return;
    setLinkValue(state.href);
  }, [panel, state.href]);

  const applyLink = () => {
    const normalized = normalizeLinkHref(linkValue);
    if (!linkValue.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setPanel(null);
      return;
    }
    if (!normalized) {
      onError("请输入有效链接");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalized }).run();
    setPanel(null);
  };

  const togglePanel = (next: Exclude<Panel, null>) => {
    setPanel((current) => (current === next ? null : next));
  };

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={80}
      options={{ placement: "top", offset: 10 }}
      shouldShow={({ editor: current, state: editorState }) =>
        !editorState.selection.empty &&
        editorState.selection.$from.parent.inlineContent &&
        !current.isActive("codeBlock")
      }
      className="editor-bubble anim-pop-in relative z-50"
    >
      <BubbleButton
        label="加粗"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="斜体"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="下划线"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <Underline className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="删除线"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="行内代码"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-3.5" />
      </BubbleButton>

      <span className="editor-bubble__divider" aria-hidden="true" />

      <BubbleButton
        label="文字颜色"
        expanded={panel === "color"}
        active={panel === "color" || Boolean(state.color)}
        onClick={() => togglePanel("color")}
      >
        <Palette className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="高亮颜色"
        expanded={panel === "highlight"}
        active={panel === "highlight" || Boolean(state.highlight)}
        onClick={() => togglePanel("highlight")}
      >
        <Highlighter className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="链接"
        expanded={panel === "link"}
        active={panel === "link" || state.link}
        onClick={() => togglePanel("link")}
      >
        <Link2 className="size-3.5" />
      </BubbleButton>

      <span className="editor-bubble__divider" aria-hidden="true" />

      <BubbleButton
        label="下标"
        active={state.subscript}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <Subscript className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="上标"
        active={state.superscript}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <Superscript className="size-3.5" />
      </BubbleButton>
      <BubbleButton label="清除格式" onClick={() => editor.chain().focus().unsetAllMarks().run()}>
        <Eraser className="size-3.5" />
      </BubbleButton>

      {panel && panel !== "link" && (
        <div className="editor-float anim-pop-in absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 p-2.5">
          <div className="mb-2 text-[10.5px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {panel === "color" ? "文字颜色" : "高亮颜色"}
          </div>
          <ColorSwatches
            colors={panel === "color" ? TEXT_COLORS : HIGHLIGHT_COLORS}
            mode={panel === "color" ? "text" : "highlight"}
            activeValue={panel === "color" ? state.color : state.highlight}
            onPick={(value) => {
              if (panel === "color") editor.chain().focus().setColor(value).run();
              else editor.chain().focus().setHighlight({ color: value }).run();
              setPanel(null);
            }}
            onClear={() => {
              if (panel === "color") editor.chain().focus().unsetColor().run();
              else editor.chain().focus().unsetHighlight().run();
              setPanel(null);
            }}
          />
        </div>
      )}

      {panel === "link" && (
        <form
          className="editor-float anim-pop-in absolute top-full left-1/2 z-50 mt-2 flex w-[292px] -translate-x-1/2 items-center gap-1.5 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink();
          }}
        >
          <input
            ref={linkInputRef}
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            placeholder="输入链接"
            aria-label="链接地址"
            onMouseDown={(event) => event.stopPropagation()}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring"
          />
          <button
            type="submit"
            className="h-8 shrink-0 cursor-default rounded-md bg-accent px-3 text-[12px] font-medium text-accent-foreground ring-1 ring-primary/25 ring-inset transition-colors duration-150 ease-[var(--ease)] hover:bg-accent-foreground/15"
          >
            应用
          </button>
          {state.link && (
            <button
              type="button"
              className="h-8 shrink-0 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setPanel(null);
              }}
            >
              移除
            </button>
          )}
        </form>
      )}
    </BubbleMenu>
  );
}
