import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Table,
  Type,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { NodeItem } from "@/types/notebook";
import { type SlashCommand, SlashMenu } from "./SlashMenu";

const MOCK_CONTENT = `
<h1>从一个想法开始</h1>
<p>星屿把文档、画板与表格放进同一个工作空间。<strong>选中态</strong>永远使用 accent 底色，<code>--primary</code> 只留给主操作。</p>
<pre><code>const theme = { preset: "sunset", mode: "light" };</code></pre>
<blockquote>设计令牌是唯一事实来源：改 tokens.css，全站跟着换肤。</blockquote>
<h2>设计令牌体系</h2>
<ul><li>8 套主题预设 × 2 种明暗模式</li><li>字号五级阶梯，正文 15px / 1.7</li><li>动效只动 transform 与 opacity</li></ul>
`;

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "text",
    label: "文本",
    group: "基础",
    icon: Type,
    apply: ({ deleteSlash }) => deleteSlash().setParagraph().run(),
  },
  {
    id: "h1",
    label: "标题 H1",
    group: "基础",
    icon: Heading1,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "标题 H2",
    group: "基础",
    icon: Heading2,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "标题 H3",
    group: "基础",
    icon: Heading3,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "无序列表",
    group: "基础",
    icon: List,
    apply: ({ deleteSlash }) => deleteSlash().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "有序列表",
    group: "基础",
    icon: ListOrdered,
    apply: ({ deleteSlash }) => deleteSlash().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "引用",
    group: "基础",
    icon: Quote,
    apply: ({ deleteSlash }) => deleteSlash().toggleBlockquote().run(),
  },
  {
    id: "hr",
    label: "分隔线",
    group: "基础",
    icon: Minus,
    apply: ({ deleteSlash }) => deleteSlash().setHorizontalRule().run(),
  },
  {
    id: "code",
    label: "代码块",
    group: "基础",
    icon: Code2,
    apply: ({ deleteSlash }) => deleteSlash().toggleCodeBlock().run(),
  },
  {
    id: "table",
    label: "表格（本阶段未实现）",
    group: "高级功能",
    icon: Table,
    mock: true,
  },
  {
    id: "sub-h1",
    label: "副标题 H1",
    group: "副标题",
    icon: Heading1,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "sub-h2",
    label: "副标题 H2",
    group: "副标题",
    icon: Heading2,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "sub-h3",
    label: "副标题 H3",
    group: "副标题",
    icon: Heading3,
    apply: ({ deleteSlash }) => deleteSlash().toggleHeading({ level: 3 }).run(),
  },
];

export interface DocEditorProps {
  node: NodeItem | null;
  title: string;
  onMockAction: (label: string) => void;
}

/** 编辑器区：徽标 → display 标题 → meta 行 → tiptap 正文（StarterKit mock）+ / slash 菜单 */
export function DocEditor({ node, title, onMockAction }: DocEditorProps) {
  const [slash, setSlash] = useState<{ x: number; y: number } | null>(null);
  // ref 同步菜单开闭状态，供 editorProps 闭包读取（避开 useEditor 的过期闭包）
  const slashRef = useRef(false);

  const closeSlash = useCallback(() => {
    slashRef.current = false;
    setSlash(null);
  }, []);

  const editor = useEditor({
    extensions: [StarterKit],
    content: node ? MOCK_CONTENT : "",
    editorProps: {
      attributes: {
        class: "tiptap min-h-full focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape" && slashRef.current) {
          closeSlash();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const { state } = ed;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\u0000");
      const shouldOpen = /(^|\s)\/$/.test(textBefore);
      if (shouldOpen) {
        const coords = ed.view.coordsAtPos(state.selection.from);
        slashRef.current = true;
        setSlash({ x: coords.left, y: coords.bottom + 4 });
      } else if (slashRef.current) {
        closeSlash();
      }
    },
  });

  if (!editor) return null;

  const handleSelect = (command: SlashCommand) => {
    if (command.mock) {
      onMockAction("表格命令");
      closeSlash();
      return;
    }
    command.apply?.({
      deleteSlash: () => {
        const pos = editor.state.selection.from;
        return editor
          .chain()
          .focus()
          .deleteRange({ from: pos - 1, to: pos });
      },
    });
    closeSlash();
  };

  const wordCount = node?.wordCount ?? 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col overflow-y-auto px-8 pt-8 pb-24">
        <div className="mb-1">
          <Badge variant="doc">文档</Badge>
        </div>
        <h1 className="mb-2 text-[length:var(--text-display)] font-extrabold leading-[var(--text-display-lh)] tracking-[var(--text-display-ls)]">
          {title}
        </h1>
        <p className={cn(CAPTION_CLS, "mb-6 text-muted-foreground")}>
          {wordCount} 字 · 创建 2026-10-12 09:30 · 最近编辑 {node?.updatedAt ?? "刚刚"}
          <span className="ml-2 italic">输入 / 以使用命令</span>
        </p>
        <EditorContent editor={editor} className="doc-content flex-1 focus-visible:outline-none" />
      </div>

      {slash && <SlashMenu position={slash} commands={SLASH_COMMANDS} onSelect={handleSelect} />}
    </div>
  );
}
