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
  Paperclip,
  Pilcrow,
  Quote,
  Smile,
  SquareCode,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onFindRequested } from "@/api/app";
import { isConflictError, toErrorMessage } from "@/api/client";
import { loadDocument } from "@/api/document";
import { onNativeFileDrop } from "@/api/dragDrop";
import { pickAttachmentFiles } from "@/api/fileDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setEditorShortcutHandlers } from "@/features/shortcuts/shortcutRuntime";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { NodeItem } from "@/types/notebook";
import { registerActivePersistence, unregisterActivePersistence } from "../activeDocument";
import { activateOutline, deactivateOutline, publishOutline } from "../editorOutline";
import { createEditorExtensions } from "../extensions/editorExtensions";
import { useBlockHandle } from "../hooks/useBlockHandle";
import { useBlockPointerDrag } from "../hooks/useBlockPointerDrag";
import { useDocumentPersistence } from "../hooks/useDocumentPersistence";
import type { SaveStatus } from "../types";
import {
  currentInsertPos,
  resolveDropInsertPos,
  uploadFilesAndInsert,
  uploadPathsAndInsert,
} from "../utils/attachmentUpload";
import { clearDraft, type DocumentDraft, readDraft, saveDraft } from "../utils/documentDraft";
import { BlockHandle } from "./BlockHandle";
import { DocFindBar } from "./DocFindBar";
import { DocHistoryDialog } from "./DocHistoryDialog";
import { DocPageBar } from "./DocPageBar";
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
  const { t } = useI18n();
  const pill =
    "inline-flex h-[22px] items-center gap-1 rounded-full border border-border/50 bg-card/45 px-2 text-[11.5px] whitespace-nowrap";
  if (status === "saving") {
    return (
      <span className={cn(pill, "text-muted-foreground")} aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" />
        {t("正在保存…")}
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className={cn(pill, "text-primary")} aria-live="polite">
        <CheckCircle2 className="size-3.5" />
        {t("已保存")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className={cn(pill, "text-destructive")} aria-live="polite">
        <AlertCircle className="size-3.5" />
        {t("保存失败")}
        <button
          type="button"
          onClick={onRetry}
          className="cursor-default rounded-sm px-1 text-[11px] underline underline-offset-2 hover:bg-destructive/10"
        >
          {t("重试")}
        </button>
      </span>
    );
  }
  if (status === "dirty") {
    return (
      <span className={cn(pill, "text-muted-foreground")} aria-live="polite">
        <Circle className="size-3.5" />
        {t("未保存")}
      </span>
    );
  }
  return (
    <span className={cn(pill, "text-muted-foreground")} aria-live="polite">
      <Circle className="size-3.5" />
      {t("自动保存")}
    </span>
  );
}

export interface DocEditorProps {
  /** 节点类型：表格复用同一编辑器，仅页头标识不同 */
  kind?: "doc" | "table";
  node: NodeItem | null;
  title: string;
  /** 所在知识库名（页头面包屑上级） */
  kbName: string | null;
  /** 当前节点是否已收藏 */
  starred: boolean;
  /** 信息浮窗是否展开 */
  infoOpen: boolean;
  /** 切换收藏状态 */
  onToggleStar: () => void;
  /** 打开 / 收起信息浮窗 */
  onToggleInfo: () => void;
  /** 打开分享与导出弹窗 */
  onShare: () => void;
  /** 触发打印 */
  onPrint: () => void;
  /** 点击面包屑中的知识库 */
  onOpenKb: () => void;
  onError?: (message: string) => void;
  onDocumentSaved?: (nodeId: string, info: { wordCount: number; updatedAt: number }) => void;
}

/** 文档编辑器：加载正文、块级自动保存、气泡/右键/Slash 菜单与拖拽手柄。 */
export function DocEditor({
  kind = "doc",
  node,
  title,
  kbName,
  starred,
  infoOpen,
  onToggleStar,
  onToggleInfo,
  onShare,
  onPrint,
  onOpenKb,
  onError,
  onDocumentSaved,
}: DocEditorProps) {
  const { t } = useI18n();
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<DocumentDraft | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [liveCount, setLiveCount] = useState(0);
  const [uploadingCount, setUploadingCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileDropRef = useRef<(current: Editor, files: File[], pos?: number) => void>(() => undefined);
  const slashRef = useRef<SlashState | null>(null);
  const suppressRef = useRef(false);
  const docSeqRef = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const outlineOwnerRef = useRef(Symbol("doc-outline"));
  const outlineSourceRef = useRef<Editor | null>(null);
  const docOwnerRef = useRef(Symbol("doc-save"));

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        onOutline: (sourceEditor, items) => {
          // 编辑器可能被 StrictMode / 切换重建；只接受当前实例的大纲，旧实例的延迟回调不得清空目录。
          if (sourceEditor !== outlineSourceRef.current) return;
          publishOutline(outlineOwnerRef.current, items);
        },
        onImageError: (message) => onErrorRef.current?.(message),
        onFilesDropped: (current, files, pos) => fileDropRef.current(current, files, pos),
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
        "aria-label": kind === "table" ? t("表格正文") : t("文档正文"),
      },
      handleKeyDown: (_view, event) => keyDownRef.current(event),
    },
    onUpdate: ({ editor: current }) => onUpdateRef.current(current),
    onSelectionUpdate: ({ editor: current }) => onSelectionUpdateRef.current(current),
  });

  const persistence = useDocumentPersistence(editor, {
    onSaved: (result) => {
      setConflict(null);
      setDraftPrompt(null);
      if (node?.id) {
        clearDraft(node.id);
        onDocumentSaved?.(node.id, {
          wordCount: result.wordCount,
          updatedAt: result.updatedAt,
        });
      }
    },
    onError: (error) => {
      const message = toErrorMessage(error);
      // 冲突不是普通网络错误：保留编辑器内容，提示用户主动重新加载。
      // 判定看原始错误文本，避免英文界面下匹配中文关键词失效。
      if (isConflictError(error)) {
        setConflict(t(message));
        return;
      }
      onErrorRef.current?.(message);
    },
  });

  // 切换文档时回到页头：否则沿用上一篇的滚动位置，面包屑会被藏到视口上方。
  // editor 进入依赖：首帧 editor 未就绪时滚动容器还没挂载，等它可用后要再归零一次。
  // biome-ignore lint/correctness/useExhaustiveDependencies: node?.id / editor 仅作为“切换文档/编辑器就绪”触发器
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [node?.id, editor]);

  // 原生菜单「查找」（⌘F）比 WKWebView 内部快捷键可靠。
  useEffect(() => {
    let disposed = false;
    let unlisten: () => void = () => undefined;
    void onFindRequested(() => {
      if (!disposed) setFindOpen(true);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  // 切换文档时关闭查找并清除高亮，避免把上一篇的匹配带到新文档。
  // biome-ignore lint/correctness/useExhaustiveDependencies: node?.id 仅作为“切换文档”触发器
  useEffect(() => {
    setFindOpen(false);
    setDraftPrompt(null);
    editor?.commands.clearFind();
  }, [node?.id, editor]);

  // 卸载时取消尚未落盘的草稿定时器。
  useEffect(
    () => () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    },
    [],
  );

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

  const beginUpload = useCallback(() => setUploadingCount((value) => value + 1), []);
  const endUpload = useCallback(() => setUploadingCount((value) => Math.max(0, value - 1)), []);

  const pickAndInsert = useCallback(
    async (kind: "images" | "attachments", pos?: number) => {
      const target = persistence.editorRef.current ?? editor;
      if (!target) return;
      try {
        const paths = await pickAttachmentFiles({ imagesOnly: kind === "images" });
        if (paths.length === 0) return;
        const sequence = docSeqRef.current;
        await uploadPathsAndInsert(target, paths, {
          kind,
          pos,
          onError: (message) => onErrorRef.current?.(message),
          onStart: beginUpload,
          onEnd: endUpload,
          isCancelled: () => docSeqRef.current !== sequence,
        });
      } catch (error) {
        onErrorRef.current?.(toErrorMessage(error));
      }
    },
    [beginUpload, editor, endUpload, persistence.editorRef],
  );

  const pickImages = useCallback(
    (pos?: number) => {
      void pickAndInsert("images", pos);
    },
    [pickAndInsert],
  );
  const pickAttachments = useCallback(
    (pos?: number) => {
      void pickAndInsert("attachments", pos);
    },
    [pickAndInsert],
  );
  const insertImagesAtSelection = useCallback(() => {
    const target = persistence.editorRef.current ?? editor;
    if (target) pickImages(currentInsertPos(target));
  }, [editor, persistence.editorRef, pickImages]);
  const insertAttachmentsAtSelection = useCallback(() => {
    const target = persistence.editorRef.current ?? editor;
    if (target) pickAttachments(currentInsertPos(target));
  }, [editor, persistence.editorRef, pickAttachments]);

  useEffect(() => {
    if (!editor) return;
    setEditorShortcutHandlers({
      "editor.bold": (current) => current.chain().focus().toggleBold().run(),
      "editor.italic": (current) => current.chain().focus().toggleItalic().run(),
      "editor.underline": (current) => current.chain().focus().toggleUnderline().run(),
      "editor.strike": (current) => current.chain().focus().toggleStrike().run(),
      "editor.code": (current) => current.chain().focus().toggleCode().run(),
      "editor.h1": (current) => current.chain().focus().toggleHeading({ level: 1 }).run(),
      "editor.h2": (current) => current.chain().focus().toggleHeading({ level: 2 }).run(),
      "editor.h3": (current) => current.chain().focus().toggleHeading({ level: 3 }).run(),
      "editor.bullet": (current) => current.chain().focus().toggleBulletList().run(),
      "editor.ordered": (current) => current.chain().focus().toggleOrderedList().run(),
      "editor.task": (current) => current.chain().focus().toggleTaskList().run(),
      "editor.quote": (current) => current.chain().focus().toggleBlockquote().run(),
      "editor.codeBlock": (current) => current.chain().focus().toggleCodeBlock().run(),
      "editor.undo": (current) => current.chain().focus().undo().run(),
      "editor.redo": (current) => current.chain().focus().redo().run(),
      "editor.image": (current) => pickImages(currentInsertPos(current)),
      "editor.attachment": (current) => pickAttachments(currentInsertPos(current)),
      "editor.find": () => setFindOpen(true),
    });
    return () => setEditorShortcutHandlers({});
  }, [editor, pickAttachments, pickImages]);

  const handleFilesDropped = useCallback(
    (target: Editor, files: File[], pos?: number) => {
      const sequence = docSeqRef.current;
      void uploadFilesAndInsert(target, files, {
        kind: "auto",
        pos,
        onError: (message) => onErrorRef.current?.(message),
        onStart: beginUpload,
        onEnd: endUpload,
        isCancelled: () => docSeqRef.current !== sequence,
      });
    },
    [beginUpload, endUpload],
  );
  fileDropRef.current = handleFilesDropped;

  /**
   * 从访达拖入文件：Tauri 默认在原生层接管拖放，网页拿不到 HTML5 drop，
   * 因此订阅 webview 事件并按绝对路径流式上传；落点坐标解析不到块时插到文档末尾。
   */
  useEffect(() => {
    if (!node?.id) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onNativeFileDrop((drop) => {
      const target = persistence.editorRef.current ?? editor;
      if (!target || disposed) return;
      const pos = resolveDropInsertPos(target, drop.clientX, drop.clientY, containerRef.current);
      if (pos === null) return;
      const sequence = docSeqRef.current;
      void uploadPathsAndInsert(target, drop.paths, {
        kind: "auto",
        pos,
        onError: (message) => onErrorRef.current?.(message),
        onStart: beginUpload,
        onEnd: endUpload,
        isCancelled: () => docSeqRef.current !== sequence,
      });
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error: unknown) => onErrorRef.current?.(toErrorMessage(error)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [beginUpload, editor, endUpload, node?.id, persistence.editorRef]);

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
        label: t("正文"),
        group: t("基础"),
        description: t("普通文本"),
        icon: Pilcrow,
        keywords: ["text", "paragraph"],
        run: (current) => current.chain().focus().setParagraph().run(),
      },
      {
        id: "h1",
        label: t("标题 H1"),
        group: t("基础"),
        description: t("大标题"),
        icon: Heading1,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "h2",
        label: t("标题 H2"),
        group: t("基础"),
        description: t("章节标题"),
        icon: Heading2,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "h3",
        label: t("标题 H3"),
        group: t("基础"),
        description: t("小节标题"),
        icon: Heading3,
        keywords: ["heading", "title"],
        run: (current) => current.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        id: "bullet",
        label: t("无序列表"),
        group: t("列表"),
        description: t("圆点列表"),
        icon: List,
        keywords: ["bullet", "list"],
        run: (current) => current.chain().focus().toggleBulletList().run(),
      },
      {
        id: "ordered",
        label: t("有序列表"),
        group: t("列表"),
        description: t("编号列表"),
        icon: ListOrdered,
        keywords: ["ordered", "list"],
        run: (current) => current.chain().focus().toggleOrderedList().run(),
      },
      {
        id: "task",
        label: t("任务列表"),
        group: t("列表"),
        description: t("待办事项"),
        icon: ListChecks,
        keywords: ["task", "todo", "check"],
        run: (current) => current.chain().focus().toggleTaskList().run(),
      },
      {
        id: "quote",
        label: t("引用"),
        group: t("内容"),
        description: t("摘录"),
        icon: Quote,
        keywords: ["quote", "blockquote"],
        run: (current) => current.chain().focus().toggleBlockquote().run(),
      },
      {
        id: "code",
        label: t("代码块"),
        group: t("内容"),
        description: t("代码"),
        icon: SquareCode,
        keywords: ["code", "pre"],
        run: (current) => current.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: "details",
        label: t("折叠块"),
        group: t("内容"),
        description: t("折叠内容"),
        icon: Code2,
        keywords: ["details", "fold", "toggle"],
        run: (current) => current.chain().focus().setDetails().run(),
      },
      {
        id: "divider",
        label: t("分隔线"),
        group: t("内容"),
        description: t("分割内容"),
        icon: Minus,
        keywords: ["hr", "divider"],
        run: (current) => current.chain().focus().setHorizontalRule().run(),
      },
      {
        id: "table",
        label: t("表格 3×3"),
        group: t("插入"),
        description: t("3×3 表格"),
        icon: Table2,
        keywords: ["table", "grid"],
        run: (current) =>
          current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: "image",
        label: t("图片"),
        group: t("插入"),
        description: t("本地图片"),
        icon: ImagePlus,
        keywords: ["image", "photo", "picture"],
        run: (current) => pickImages(currentInsertPos(current)),
      },
      {
        id: "attachment",
        label: t("附件"),
        group: t("插入"),
        description: t("任意文件"),
        icon: Paperclip,
        keywords: ["file", "attachment", "attach"],
        run: (current) => pickAttachments(currentInsertPos(current)),
      },
      {
        id: "emoji",
        label: t("表情"),
        group: t("插入"),
        description: t("符号"),
        icon: Smile,
        keywords: ["emoji", "smile"],
        run: (current) => current.chain().focus().setEmoji("sparkles").run(),
      },
    ],
    [pickAttachments, pickImages, t],
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
    if (node?.id) {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        draftTimerRef.current = null;
        saveDraft(node.id, current.getJSON());
      }, 500);
    }
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
    outlineSourceRef.current = editor;
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
    return () => {
      if (outlineSourceRef.current === editor) outlineSourceRef.current = null;
      deactivateOutline(owner);
    };
  }, [editor]);

  // 切换标签/工作区前由控制器 flush；卸载时再兜底一次。
  useEffect(() => {
    if (!editor) return;
    const owner = docOwnerRef.current;
    registerActivePersistence(owner, persistence.flush);
    return () => {
      void persistence.flush();
      unregisterActivePersistence(owner);
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
      setConflict(null);
      setLoading(true);
      hideHandle();
      // setEditable 默认会 emit update，加载/切换期间必须关闭，否则会把旧文档误标脏。
      editor.setEditable(false, false);
      const flushed = await persistence.flush();
      if (cancelled || sequence !== docSeqRef.current) return;
      if (!flushed) {
        setLoadError(t("上一份文档尚未保存，请重试"));
        // 失败分支必须恢复可编辑，否则用户修好保存问题后正文仍是只读。
        editor.setEditable(true, false);
        setLoading(false);
        return;
      }

      const nodeId = node?.id ?? null;
      if (!nodeId) {
        suppressRef.current = true;
        editor.commands.setContent(EMPTY_DOC, { emitUpdate: false });
        suppressRef.current = false;
        editor.commands.updateTableOfContents();
        persistence.beginDocument(null);
        persistence.setBaseline(0, 0, 0);
        setLiveCount(0);
        setLoading(false);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
        return;
      }

      try {
        const loaded = await loadDocument(nodeId);
        if (cancelled || sequence !== docSeqRef.current) return;
        if (loaded.document.type !== "doc" || !Array.isArray(loaded.document.content)) {
          throw new Error(t("文档内容无法读取"));
        }
        const hasContent = loaded.document.content.length > 0;
        suppressRef.current = true;
        editor.commands.setContent(hasContent ? loaded.document : EMPTY_DOC, {
          emitUpdate: false,
        });
        suppressRef.current = false;
        persistence.beginDocument(nodeId);
        persistence.setBaseline(loaded.wordCount, loaded.updatedAt, loaded.version);
        const draft = readDraft(nodeId);
        if (draft && draft.savedAt > loaded.updatedAt) {
          setDraftPrompt(draft);
        } else {
          clearDraft(nodeId);
          setDraftPrompt(null);
        }
        setLiveCount(loaded.wordCount);
        editor.setEditable(true, false);
        setLoading(false);
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        });
        // setContent 走 emitUpdate:false，TOC 不会自行刷新；显式发布一次，页头目录在首次打开时即可用。
        editor.commands.updateTableOfContents();
        // 后端修复了历史 `:null:`/null attrs：自动补一次保存，让块树与正文同步。
        if (loaded.normalized) persistence.markDirty();
      } catch (error) {
        if (cancelled || sequence !== docSeqRef.current) return;
        persistence.beginDocument(null);
        setLoadError(toErrorMessage(error));
        editor.setEditable(true, false);
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
          {t("正在初始化编辑器…")}
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
            <DocPageBar
              title={title}
              kbName={kbName}
              starred={starred}
              infoOpen={infoOpen}
              onToggleStar={onToggleStar}
              onToggleInfo={onToggleInfo}
              onShare={onShare}
              onPrint={onPrint}
              onHistory={() => setHistoryOpen(true)}
              onOpenKb={onOpenKb}
            />
            <div className="mb-3 flex items-center gap-2">
              <Badge variant="doc">{kind === "table" ? t("表格") : t("文档")}</Badge>
              <SaveIndicator status={persistence.status} onRetry={() => void persistence.retry()} />
            </div>
            {findOpen && <DocFindBar editor={editor} onClose={() => setFindOpen(false)} />}
            <h1 className="doc-editor-title">{title}</h1>
            <div className={cn(CAPTION_CLS, "doc-editor-meta")}>
              <span>
                {displayCount} {t("字")}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {t("最近编辑")} {displayUpdatedAt ? formatTimestamp(displayUpdatedAt) : t("刚刚")}
              </span>
              {uploadingCount > 0 && (
                <span
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground"
                  aria-live="polite"
                >
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("正在上传附件…")}
                </span>
              )}
            </div>
          </header>

          {draftPrompt && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-primary/35 bg-accent/45 px-3.5 py-2.5 text-[12.5px] text-foreground"
            >
              <span>{t("检测到未保存的草稿，可恢复到编辑器。")}</span>
              <span className="flex shrink-0 gap-1.5">
                <Button
                  size="sm"
                  onClick={() => {
                    if (!editor) return;
                    suppressRef.current = true;
                    editor.commands.setContent(draftPrompt.document, { emitUpdate: false });
                    suppressRef.current = false;
                    persistence.markDirty();
                    setDraftPrompt(null);
                  }}
                >
                  {t("恢复草稿")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (node?.id) clearDraft(node.id);
                    setDraftPrompt(null);
                  }}
                >
                  {t("忽略")}
                </Button>
              </span>
            </div>
          )}

          {conflict && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="size-4 text-destructive" />
                {t("文档已在别处更新；重新加载会丢失当前修改。")}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  persistence.discard();
                  setConflict(null);
                  setReloadToken((value) => value + 1);
                }}
              >
                {t("放弃修改并重新加载")}
              </Button>
            </div>
          )}

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
                {t("重新加载")}
              </Button>
            </div>
          )}

          <div ref={containerRef} className="doc-editor-body">
            <EditorContent editor={editor} className="doc-content focus-visible:outline-none" />{" "}
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
                  {t("正在加载正文…")}
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
          onInsertImage={insertImagesAtSelection}
          onInsertAttachment={insertAttachmentsAtSelection}
          onError={reportError}
        />
      )}

      {node?.id && (
        <DocHistoryDialog
          open={historyOpen}
          nodeId={node.id}
          onOpenChange={setHistoryOpen}
          onRestored={() => {
            persistence.discard();
            setConflict(null);
            setDraftPrompt(null);
            setReloadToken((value) => value + 1);
          }}
        />
      )}
    </div>
  );
}
