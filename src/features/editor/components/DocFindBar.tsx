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

  const jump = (direction: "next" | "prev") => {
    if (!editor) return;
    if (direction === "next") editor.commands.findNext();
    else editor.commands.findPrev();
    const current = findPluginKey.getState(editor.state);
    const match = current?.matches[current.active];
    if (match) {
      editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
    }
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    editor?.commands.setFindQuery(value);
  };

  return (
    <search
      className="mb-3 flex items-center gap-2 rounded-[10px] border border-border/70 bg-card/90 px-2.5 py-1.5 shadow-sm"
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
