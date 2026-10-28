import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";

const HANDLE_GAP = 4;
const HANDLE_WIDTH = 44;
const HANDLE_HEIGHT = 24;
const HIDE_DELAY = 180;
const BLOCK_TOP_TOLERANCE = 8;
const BLOCK_BOTTOM_TOLERANCE = 24;

export interface BlockAnchor {
  /** 顶层块在文档中的起始位置 */
  pos: number;
  /** 顶层块类型名，用于手柄提示 */
  type: string;
  /** 手柄容器相对 .doc-editor-body 的纵坐标 */
  top: number;
  /** 手柄容器相对 .doc-editor-body 的横坐标 */
  left: number;
}

export interface UseBlockHandleOptions {
  editor: Editor | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface CachedBlock {
  pos: number;
  type: string;
  element: HTMLElement;
  /** 相对视口的块顶边（缓存期内的快照） */
  top: number;
  bottom: number;
  height: number;
}

interface BlockCache {
  blocks: CachedBlock[];
  containerTop: number;
  /** 手柄相对容器的横坐标 */
  handleLeft: number;
}

/**
 * 自绘块级手柄：根据鼠标所在顶层块计算手柄位置，并管理显隐时机。
 *
 * 不使用官方 @tiptap/extension-drag-handle：它把定位与 HTML5 拖放绑定在一起，
 * 在 WKWebView 中 dragstart 后既无法可靠搬运正文，也会因 mouseleave 立即隐藏手柄。
 * 这里只依赖编辑器公开 API（state.doc / view.nodeDOM / getBoundingClientRect）定位。
 */
export function useBlockHandle({ editor, containerRef }: UseBlockHandleOptions) {
  const [anchor, setAnchor] = useState<BlockAnchor | null>(null);
  const [visible, setVisible] = useState(false);
  const anchorRef = useRef<BlockAnchor | null>(null);
  const visibleRef = useRef(false);
  const hideTimerRef = useRef(0);
  const hideRef = useRef<() => void>(() => undefined);
  const cacheRef = useRef<BlockCache | null>(null);
  const dirtyRef = useRef(true);

  const getAnchorPos = useCallback(() => anchorRef.current?.pos ?? null, []);
  const hideHandle = useCallback(() => hideRef.current(), []);

  useEffect(() => {
    if (!editor) return;
    const container = containerRef.current;
    const scroller = container?.closest<HTMLElement>(".doc-editor-scroll");
    const viewDom = editor.view.dom;
    if (!container) return;

    const cancelHide = () => {
      if (hideTimerRef.current !== 0) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = 0;
      }
    };

    const hide = () => {
      cancelHide();
      if (!visibleRef.current) return;
      visibleRef.current = false;
      setVisible(false);
    };
    hideRef.current = hide;

    const scheduleHide = (delay = HIDE_DELAY) => {
      cancelHide();
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = 0;
        if (!visibleRef.current) return;
        visibleRef.current = false;
        setVisible(false);
      }, delay);
    };

    const view = editor.view;

    /**
     * 重建块矩形缓存。文档变更（update/selectionUpdate）、滚动、窗口尺寸变化后失效；
     * mousemove 只做 rAF 合帧 + 读缓存，不再每次事件都逐块 getBoundingClientRect。
     */
    const rebuildCache = (): BlockCache => {
      const containerRect = container.getBoundingClientRect();
      const editorRect = view.dom.getBoundingClientRect();
      const doc = view.state.doc;
      const blocks: CachedBlock[] = [];
      let offset = 0;
      for (let index = 0; index < doc.childCount; index += 1) {
        const node = doc.child(index);
        const dom = view.nodeDOM(offset);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          blocks.push({
            pos: offset,
            type: node.type.name,
            element: dom,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
          });
        }
        offset += node.nodeSize;
      }
      const cache: BlockCache = {
        blocks,
        containerTop: containerRect.top,
        handleLeft: editorRect.left - containerRect.left - HANDLE_WIDTH - HANDLE_GAP,
      };
      cacheRef.current = cache;
      dirtyRef.current = false;
      return cache;
    };

    const anchorFromCache = (clientY: number): BlockAnchor | null => {
      const cache = cacheRef.current;
      if (!cache) return null;
      let best: CachedBlock | null = null;
      let bestIndex = -1;
      for (let index = 0; index < cache.blocks.length; index += 1) {
        const block = cache.blocks[index];
        if (block.height > 0 && clientY >= block.top - BLOCK_TOP_TOLERANCE) {
          best = block;
          bestIndex = index;
        }
      }
      if (!best) return null;
      const isLast = bestIndex === cache.blocks.length - 1;
      if (isLast && clientY > best.bottom + BLOCK_BOTTOM_TOLERANCE) return null;
      const style = window.getComputedStyle(best.element);
      const lineHeight = Number.parseFloat(style.lineHeight) || 24;
      const offsetInBlock = Math.min(Math.max(lineHeight / 2, 10), Math.max(best.height / 2, 10));
      return {
        pos: best.pos,
        type: best.type,
        top: best.top - cache.containerTop + offsetInBlock - HANDLE_HEIGHT / 2,
        left: cache.handleLeft,
      };
    };

    const measure = (clientY: number): BlockAnchor | null => {
      if (!editor.isEditable || editor.isDestroyed) return null;
      if (dirtyRef.current || !cacheRef.current) {
        rebuildCache();
      }
      return anchorFromCache(clientY);
    };

    const show = (next: BlockAnchor) => {
      cancelHide();
      const previous = anchorRef.current;
      if (
        !previous ||
        previous.pos !== next.pos ||
        previous.type !== next.type ||
        Math.abs(previous.top - next.top) > 0.5 ||
        Math.abs(previous.left - next.left) > 0.5
      ) {
        anchorRef.current = next;
        setAnchor(next);
      }
      if (!visibleRef.current) {
        visibleRef.current = true;
        setVisible(true);
      }
    };

    const handleMouseLeave = () => {
      if (document.body.classList.contains("starris-block-dragging")) return;
      scheduleHide();
    };

    const handleMouseOver = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".editor-block-handle")) cancelHide();
    };

    const handleScroll = () => {
      if (document.body.classList.contains("starris-block-dragging")) return;
      dirtyRef.current = true;
      hide();
    };

    const handleKeyDown = () => hide();

    // 文档内容变化后块矩形缓存失效；滚动/resize 走 handleScroll 统一标脏。
    const onDocChange = () => {
      dirtyRef.current = true;
    };
    editor.on("update", onDocChange);

    // mousemove 每帧可能触发多次；合帧到 rAF，一次事件批次最多一次测量。
    let pendingY: number | null = null;
    let moveFrame = 0;
    const runMeasure = () => {
      moveFrame = 0;
      const clientY = pendingY;
      pendingY = null;
      if (clientY === null) return;
      const next = measure(clientY);
      if (!next) {
        scheduleHide(120);
        return;
      }
      show(next);
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!editor.isEditable || document.body.classList.contains("starris-block-dragging")) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".editor-block-handle")) {
        cancelHide();
        return;
      }
      const editorRect = viewDom.getBoundingClientRect();
      if (event.clientX < editorRect.left - 72 || event.clientX > editorRect.right + 8) {
        scheduleHide(120);
        return;
      }
      // 从正文移向左侧手柄时保持当前块，避免手柄在走廊里跳到相邻行；
      // 若在走廊内纵向移动超过一行，则重新按 Y 定位，防止仍指向旧块。
      if (event.clientX < editorRect.left - 2 && anchorRef.current) {
        const anchorCenterY =
          container.getBoundingClientRect().top + anchorRef.current.top + HANDLE_HEIGHT / 2;
        if (Math.abs(event.clientY - anchorCenterY) <= 22) {
          cancelHide();
          return;
        }
      }
      pendingY = event.clientY;
      if (moveFrame === 0) moveFrame = window.requestAnimationFrame(runMeasure);
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);
    container.addEventListener("mouseover", handleMouseOver);
    viewDom.addEventListener("keydown", handleKeyDown);
    scroller?.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      cancelHide();
      if (moveFrame !== 0) window.cancelAnimationFrame(moveFrame);
      editor.off("update", onDocChange);
      cacheRef.current = null;
      dirtyRef.current = true;
      hideRef.current = () => undefined;
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      container.removeEventListener("mouseover", handleMouseOver);
      viewDom.removeEventListener("keydown", handleKeyDown);
      scroller?.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [editor, containerRef]);

  return { anchor, visible, getAnchorPos, hideHandle };
}
