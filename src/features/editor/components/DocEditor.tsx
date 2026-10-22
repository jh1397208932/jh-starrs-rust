import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Minus,
  Pilcrow,
  Quote,
  Smile,
  SquareCode,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { loadDocument } from "@/api/document";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { NodeItem } from "@/types/notebook";
import { registerActiveDocument, unregisterActiveDocument } from "../activeDocument";
import { activateOutline, deactivateOutline, publishOutline } from "../editorOutline";
import { createEditorExtensions } from "../extensions/editorExtensions";
import { useBlockHandle } from "../hooks/useBlockHandle";
import { useBlockPointerDrag } from "../hooks/useBlockPointerDrag";
import { useDocumentPersistence } from "../hooks/useDocumentPersistence";
import type { SaveStatus } from "../types";
import { insertImageFiles } from "../utils/image";
import { BlockHandle } from "./BlockHandle";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { EditorContextMenu } from "./EditorContextMenu";
import { filterSlashCommands, type SlashCommand, SlashMenu } from "./SlashMenu";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

interface SlashState {
  x: number;
  y: number;
  query: string;
  from: number;
  to: number;
  activeIndex: number;
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" />
        正在保存…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-primary" aria-live="polite">
        <CheckCircle2 className="size-3.5" />
        已保存
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive" aria-live="polite">
        <AlertCircle className="size-3.5" />
        保存失败
        <button
          type="button"
          onClick={onRetry}
          className="cursor-default rounded-sm px-1 text-[11.5px] underline underline-offset-2 hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          重试
        </button>
      </span>
    );
  }
  if (status === "dirty") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground" aria-live="polite">
        <Circle className="size-3.5" />
        有未保存更改…
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground" aria-live="polite">
      <Circle className="size-3.5" />
      本地自动保存
    </span>
  );
}

export interface DocEditorProps {
  node: NodeItem | null;
  title: string;
  onError?: (message: string) => void;
  onDocumentSaved?: (nodeId: string, info: { wordCount: number; updatedAt: number }) => void;
}

/** 文档编辑器：加载正文、块级自动保存、气泡/右键/Slash 菜单与拖拽手柄。 */
export function DocEditor({ node, title, onError, onDocumentSaved }: DocEditorProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [liveCount, setLiveCount] = useState(0);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const suppressRef = useRef(false);
  const docSeqRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const outlineOwnerRef = useRef(Symbol("doc-outline"));
  const docOwnerRef = useRef(Symbol("doc-save"));

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        onOutline: (items) => publishOutline(outlineOwnerRef.current, items),
        onImageError: (message) => onErrorRef.current?.(message),
      }),
    [],
  );

  const onUpdateRef = useRef<(current: Editor) => void>(() => undefined);
  const onSelectionUpdateRef = useRef<(current: Editor) => void>(() => undefined);
  const keyDownRef = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const editor = useEditor({
    extensions,
    content: EMPTY_DOC,
    editorProps: {
      attributes: {
        class: "tiptap min-h-full focus:outline-none",
        "aria-label": "文档正文",
      },
      handleKeyDown: (_view, event) => keyDownRef.current(event),
    },
    onUpdate: ({ editor: current }) => onUpdateRef.current(current),
    onSelectionUpdate: ({ editor: current }) => onSelectionUpdateRef.current(current),
  });

  const persistence = useDocumentPersistence(editor, {
    onSaved: (result) => {
      if (node?.id) {
        onDocumentSaved?.(node.id, {
          wordCount: result.wordCount,
          updatedAt: result.updatedAt,
        });
      }
    },
    onError: (error) => onErrorRef.current?.(toErrorMessage(error)),
  });

  const closeSlash = useCallback(() => {
    slashRef.current = null;
    setSlash(null);
  }, []);

  const syncSlash = useCallback(
    (current: Editor, allowOpen: boolean) => {
      if (!allowOpen && !slashRef.current) return;
      const { state } = current;
      if (!state.selection.empty || current.isActive("codeBlock")) {
        closeSlash();
        return;
      }
      const { $from, from } = state.selection;
      let textBefore = "";
      try {
        textBefore = $from.parent.textBetween(0, $from.parentOffset, "\n", "\u0000");
      } catch {
        closeSlash();
        return;
      }
      // 中文行文常无空格：句末标点后也允许唤起命令；只需保证 / 前不是普通词。
      const match = /(?:^|[\s。！？；：、，,.!?;:（）()《》“”"'`])\/([^\s/]*)$/.exec(textBefore);
      if (!match) {
        closeSlash();
        return;
      }
      const query = match[1] ?? "";
      const start = from - query.length - 1;
      if (start < 0) {
        closeSlash();
        return;
      }
      const coords = current.view.coordsAtPos(from);
      const previous = slashRef.current;
      const next: SlashState = {
        x: coords.left,
        y: coords.bottom + 4,
        query,
        from: start,
        to: from,
        activeIndex: previous && previous.query === query ? previous.activeIndex : 0,
      };
      slashRef.current = next;
      setSlash(next);
    },
    [closeSlash],
  );

  const imagePicker = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const {
    anchor: blockAnchor,
    visible: blockHandleVisible,
    getAnchorPos,
    hideHandle,
  } = useBlockHandle({ editor, containerRef });

  /** 在候选块之后插入一个空段落，并把光标移入新块。 */
  const addBlockBelow = useCallback(() => {
    if (!editor) return;
    const pos = getAnchorPos();
    if (pos === null || pos < 0) return;
    const node = editor.state.doc.nodeAt(pos);
    if (!node) return;
    const insertPos = pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, { type: "paragraph" })
      .setTextSelection(insertPos + 1)
      .scrollIntoView()
      .run();
  }, [editor, getAnchorPos]);

  const getScroller = useCallback(() => scrollRef.current, []);
  const beforeBlockDrag = useCallback(() => {
    closeSlash();
    setContextMenu(null);
    if (editor && !editor.state.selection.empty) {
      editor.commands.setTextSelection(editor.state.selection.from);
    }
  }, [closeSlash, editor]);
  const handleBlockDragActive = useCallback(
    (active: boolean) => {
      if (!active) hideHandle();
    },
    [hideHandle],
  );
  const { startPointerDrag } = useBlockPointerDrag({
    editor,
    getSourcePos: getAnchorPos,
    getScroller,
    onBeforeActivate: beforeBlockDrag,
    onActiveChange: handleBlockDragActive,
  });

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "paragraph",
        label: "正文",
        group: "基础",
        description: "普通文本段落",
        icon: Pilcrow,
        keywords: ["text", "paragraph"],
        run: (current) => current.chain().focus().setParagraph().run(),
      },
      {
        id: "h1",
        label: "标题 H1",
        group: "基础",
        description: "页面级大标题",
        icon: Heading1,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "h2",
        label: "标题 H2",
        group: "基础",
        description: "章节标题",
        icon: Heading2,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "h3",
        label: "标题 H3",
        group: "基础",
        description: "小节标题",
        icon: Heading3,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        id: "bullet",
        label: "无序列表",
        group: "列表",
        description: "以圆点组织要点",
        icon: List,
        keywords: ["bullet", "list"],
        run: (current) => current.chain().focus().toggleBulletList().run(),
      },
      {
        id: "ordered",
        label: "有序列表",
        group: "列表",
        description: "按编号排列步骤",
        icon: ListOrdered,
        keywords: ["ordered", "list"],
        run: (current) => current.chain().focus().toggleOrderedList().run(),
      },
      {
        id: "task",
        label: "任务列表",
        group: "列表",
        description: "可勾选的待办事项",
        icon: ListChecks,
        keywords: ["task", "todo", "check"],
        run: (current) => current.chain().focus().toggleTaskList().run(),
      },
      {
        id: "quote",
        label: "引用",
        group: "块",
        description: "强调摘录与旁注",
        icon: Quote,
        keywords: ["quote", "blockquote"],
        run: (current) => current.chain().focus().toggleBlockquote().run(),
      },
      {
        id: "code",
        label: "代码块",
        group: "块",
        description: "带语法高亮的代码",
        icon: SquareCode,
        keywords: ["code", "pre"],
        run: (current) => current.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: "details",
        label: "折叠块",
        group: "块",
        description: "收纳次要内容",
        icon: Code2,
        keywords: ["details", "fold", "toggle"],
        run: (current) => current.chain().focus().setDetails().run(),
      },
      {
        id: "divider",
        label: "分隔线",
        group: "块",
        description: "划分内容层次",
        icon: Minus,
        keywords: ["hr", "divider"],
        run: (current) => current.chain().focus().setHorizontalRule().run(),
      },
      {
        id: "table",
        label: "表格 3×3",
        group: "插入",
        description: "带表头的可调整表格",
        icon: Table2,
        keywords: ["table", "grid"],
        run: (current) =>
          current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: "image",
        label: "图片",
        group: "插入",
        description: "插入本地图片（≤2MB）",
        icon: ImagePlus,
        keywords: ["image", "photo", "picture"],
        run: () => imagePicker(),
      },
      {
        id: "emoji",
        label: "表情",
        group: "插入",
        description: "为正文增添一个表情",
        icon: Smile,
        keywords: ["emoji", "smile"],
        run: (current) => current.chain().focus().setEmoji("sparkles").run(),
      },
    ],
    [imagePicker],
  );

  const slashItems = slash ? filterSlashCommands(slashCommands, slash.query) : [];

  const selectSlashCommand = useCallback(
    (command: SlashCommand) => {
      const currentSlash = slashRef.current;
      const current = persistence.editorRef.current;
      closeSlash();
      if (!current || !currentSlash) return;
      current.chain().focus().deleteRange({ from: currentSlash.from, to: currentSlash.to }).run();
      command.run(current);
    },
    [closeSlash, persistence.editorRef],
  );

  onUpdateRef.current = (current) => {
    if (suppressRef.current) return;
    setLiveCount(current.storage.characterCount.characters());
    syncSlash(current, true);
    persistence.markDirty();
  };
  onSelectionUpdateRef.current = (current) => {
    if (suppressRef.current) return;
    syncSlash(current, false);
  };
  keyDownRef.current = (event) => {
    const currentSlash = slashRef.current;
    if (!currentSlash) return false;
    if (event.key === "Escape") {
      closeSlash();
      return true;
    }
    const items = filterSlashCommands(slashCommands, currentSlash.query);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (items.length === 0) return true;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const activeIndex = (currentSlash.activeIndex + step + items.length) % items.length;
      const next = { ...currentSlash, activeIndex };
      slashRef.current = next;
      setSlash(next);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const command = items[currentSlash.activeIndex] ?? items[0];
      if (command) {
        selectSlashCommand(command);
        return true;
      }
    }
    return false;
  };

  // 大纲：编辑器就绪后认领，并发布 TOC 扩展的初始结果。
  useEffect(() => {
    if (!editor) return;
    const owner = outlineOwnerRef.current;
    activateOutline(owner, editor);
    const publish = () => {
      const content = editor.storage.tableOfContents?.content ?? [];
      publishOutline(
        owner,
        content.map((item) => ({
          id: item.id,
          text: item.textContent,
          level: item.level,
          pos: item.pos,
        })),
      );
    };
    publish();
    return () => deactivateOutline(owner);
  }, [editor]);

  // 切换标签/工作区前由控制器 flush；卸载时再兜底一次。
  useEffect(() => {
    if (!editor) return;
    const owner = docOwnerRef.current;
    registerActiveDocument(owner, persistence.flush);
    return () => {
      void persistence.flush();
      unregisterActiveDocument(owner);
    };
  }, [editor, persistence.flush]);

  // 加载正文：先 flush 旧文档；加载失败不切换 nodeId，避免空正文覆盖旧数据。
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken 仅作为“重新加载”触发器
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const sequence = ++docSeqRef.current;

    const load = async () => {
      setLoadError(null);
      setLoading(true);
      hideHandle();
      // setEditable 默认会 emit update，加载/切换期间必须关闭，否则会把旧文档误标脏。
      editor.setEditable(false, false);
      const flushed = await persistence.flush();
      if (cancelled || sequence !== docSeqRef.current) return;
      if (!flushed) {
        setLoadError("上一份文档尚未保存成功，请重试保存后再切换");
        setLoading(false);
        return;
      }

      const nodeId = node?.id ?? null;
      if (!nodeId) {
        suppressRef.current = true;
        editor.commands.setContent(EMPTY_DOC, { emitUpdate: false });
        suppressRef.current = false;
        persistence.beginDocument(null);
        persistence.setBaseline(0, 0);
        setLiveCount(0);
        setLoading(false);
        return;
      }

      try {
        const loaded = await loadDocument(nodeId);
        if (cancelled || sequence !== docSeqRef.current) return;
        if (loaded.document.type !== "doc" || !Array.isArray(loaded.document.content)) {
          throw new Error("文档数据格式异常：根节点必须是 doc 且包含 content 数组");
        }
        const hasContent = loaded.document.content.length > 0;
        suppressRef.current = true;
        editor.commands.setContent(hasContent ? loaded.document : EMPTY_DOC, {
          emitUpdate: false,
        });
        suppressRef.current = false;
        persistence.beginDocument(nodeId);
        persistence.setBaseline(loaded.wordCount, loaded.updatedAt);
        setLiveCount(loaded.wordCount);
        editor.setEditable(true, false);
        setLoading(false);
        // 后端修复了历史 `:null:`/null attrs：自动补一次保存，让块树与正文同步。
        if (loaded.normalized) persistence.markDirty();
      } catch (error) {
        if (cancelled || sequence !== docSeqRef.current) return;
        persistence.beginDocument(null);
        setLoadError(toErrorMessage(error));
        setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    editor,
    node?.id,
    reloadToken,
    hideHandle,
    persistence.flush,
    persistence.beginDocument,
    persistence.setBaseline,
  ]);

  // 编辑器内的右键：先把光标定位到点击位置，再打开统一浮层。
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const at = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (at) {
        const { from, to, empty } = editor.state.selection;
        const insideSelection = !empty && at.pos >= from && at.pos <= to;
        // 右键落在已选文字内时保留选区，颜色/高亮等命令才能作用到选中文本。
        if (!insideSelection) editor.chain().focus().setTextSelection(at.pos).run();
      }
      closeSlash();
      setContextMenu({ x: event.clientX, y: event.clientY });
    };
    dom.addEventListener("contextmenu", handleContextMenu);
    return () => dom.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, closeSlash]);

  const reportError = useCallback((message: string) => {
    onErrorRef.current?.(message);
  }, []);

  if (!editor) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在初始化编辑器…
        </span>
      </div>
    );
  }

  const displayCount = liveCount > 0 ? liveCount : persistence.wordCount;
  const displayUpdatedAt = persistence.updatedAt || node?.updatedAt || 0;

  return (
    <div className="doc-editor flex h-full flex-col overflow-hidden">
      <div ref={scrollRef} className="doc-editor-scroll">
        <div className="doc-editor-page">
          <header className="doc-editor-header">
            <div className="mb-3 flex items-center gap-2">
              <Badge variant="doc">文档</Badge>
              <span className="doc-editor-hint">输入 / 唤起命令</span>
            </div>
            <h1 className="doc-editor-title">{title}</h1>
            <div className={cn(CAPTION_CLS, "doc-editor-meta")}>
              <span>{displayCount} 字</span>
              <span aria-hidden="true">·</span>
              <span>创建 {node ? formatTimestamp(node.createdAt) : "刚刚"}</span>
              <span aria-hidden="true">·</span>
              <span>最近编辑 {displayUpdatedAt ? formatTimestamp(displayUpdatedAt) : "刚刚"}</span>
              <span className="ml-auto">
                <SaveIndicator status={persistence.status} onRetry={() => void persistence.retry()} />
              </span>
            </div>
          </header>

          {loadError && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="size-4 text-destructive" />
                {loadError}
              </span>
              <Button variant="outline" size="sm" onClick={() => setReloadToken((value) => value + 1)}>
                重新加载
              </Button>
            </div>
          )}

          <div ref={containerRef} className="doc-editor-body">
            <EditorContent editor={editor} className="doc-content focus-visible:outline-none" />
            {blockAnchor && (
              <BlockHandle
                targetPos={blockAnchor.pos}
                targetType={blockAnchor.type}
                top={blockAnchor.top}
                left={blockAnchor.left}
                visible={blockHandleVisible}
                onAddBelow={addBlockBelow}
                onGripPointerDown={startPointerDrag}
              />
            )}
            {loading && (
              <div className="doc-editor-loading">
                <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  正在加载正文…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {!loading && <EditorBubbleMenu editor={editor} onError={reportError} />}

      {slash && (
        <SlashMenu
          position={{ x: slash.x, y: slash.y }}
          commands={slashItems}
          activeIndex={slash.activeIndex}
          onSelect={selectSlashCommand}
          onHover={(index) => {
            const current = slashRef.current;
            if (!current) return;
            const next = { ...current, activeIndex: index };
            slashRef.current = next;
            setSlash(next);
          }}
        />
      )}

      {contextMenu && (
        <EditorContextMenu
          editor={editor}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
          onInsertImage={imagePicker}
          onError={reportError}
        />
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) {
            void insertImageFiles(editor, files, { onError: reportError });
          }
        }}
      />
    </div>
  );
}
