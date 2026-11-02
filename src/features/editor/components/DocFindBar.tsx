import type { Editor } from "@tiptap/react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { type FindState, findPluginKey } from "../extensions/findHighlight";

export interface DocFindBarProps {
  editor: Editor | null;
  onClose: () => void;
}

function readFind(editor: Editor | null): FindState {
  return (
    (editor && findPluginKey.getState(editor.state)) ?? {
      query: "",
      matches: [],
      active: 0,
    }
  );
}

/**
 * 文档内查找条：输入即时高亮，Enter/Shift+Enter 跳转，Esc 关闭。
 * 只读装饰，不修改正文，也不会触保存。
 */
export function DocFindBar({ editor, onClose }: DocFindBarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [find, setFind] = useState<FindState>(() => readFind(editor));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!editor) return;
    const sync = () => setFind(readFind(editor));
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.clearFind();
    return () => {
      editor.commands.clearFind();
    };
  }, [editor]);

  const close = () => {
    editor?.commands.clearFind();
    onClose();
  };

  /** 命中可能在当前视口外；查找框持有焦点时编辑器不会自己滚动，这里显式滚容器。 */
  const scrollToMatch = (from: number) => {
    if (!editor) return;
    const view = editor.view;
    const scroller = view.dom.closest<HTMLElement>(".doc-editor-scroll");
    if (!scroller) return;
    try {
      const coords = view.coordsAtPos(from);
      const rect = scroller.getBoundingClientRect();
      const offset = coords.top - rect.top;
      const margin = 72;
      if (offset >= margin && offset <= scroller.clientHeight - margin) return;
      const target = scroller.scrollTop + offset - scroller.clientHeight * 0.32;
      scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    } catch {
      // 位置暂时不可测（节点正在销毁/布局中）：下一次跳转再试。
    }
  };

  const jumpTo = (from: number, to: number) => {
    if (!editor) return;
    editor.chain().setTextSelection({ from, to }).scrollIntoView().run();
    requestAnimationFrame(() => scrollToMatch(from));
  };

  const jump = (direction: "next" | "prev") => {
    if (!editor) return;
    if (direction === "next") editor.commands.findNext();
    else editor.commands.findPrev();
    const current = findPluginKey.getState(editor.state);
    const match = current?.matches[current.active];
    if (match) jumpTo(match.from, match.to);
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    if (!editor) return;
    editor.commands.setFindQuery(value);
    // 输入后直接落到第一处：只算高亮不滚动，用户会以为查找没生效。
    const current = findPluginKey.getState(editor.state);
    const match = current?.matches[0];
    if (match) jumpTo(match.from, match.to);
  };

  return (
    <search
      className="flex items-center gap-2 rounded-[10px] border border-border/70 bg-card/95 px-2.5 py-1.5 shadow-md backdrop-blur-md"
      aria-label={t("文档内查找")}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => updateQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if (event.key === "Enter") {
            event.preventDefault();
            jump(event.shiftKey ? "prev" : "next");
          }
        }}
        aria-label={t("查找内容")}
        placeholder={t("查找…")}
        className="h-6 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
      />
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
        {find.matches.length === 0 ? "0 / 0" : `${find.active + 1} / ${find.matches.length}`}
      </span>
      <button
        type="button"
        aria-label={t("上一处")}
        onClick={() => jump("prev")}
        disabled={find.matches.length === 0}
        className="grid size-6 cursor-default place-items-center rounded-[6px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:opacity-40"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("下一处")}
        onClick={() => jump("next")}
        disabled={find.matches.length === 0}
        className="grid size-6 cursor-default place-items-center rounded-[6px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-foreground active:scale-[0.94] disabled:opacity-40"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("关闭查找")}
        onClick={close}
        className="grid size-6 cursor-default place-items-center rounded-[6px] text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[var(--ease)] hover:bg-accent hover:text-foreground active:scale-[0.94]"
      >
        <X className="size-3.5" />
      </button>
    </search>
  );
}
