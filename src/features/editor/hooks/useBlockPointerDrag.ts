import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";
import { blockTypeLabel } from "../blockLabels";
import { BLOCK_DRAG_SOURCE_META } from "../extensions/blockDragHighlight";
import { measureEditorContentBox, moveTopLevelNode } from "../utils/blockDrag";

const DRAG_THRESHOLD = 4;
const SCROLL_EDGE = 56;
const SCROLL_STEP = 22;

interface DropTarget {
  insertPos: number;
  lineTop: number;
  lineLeft: number;
  lineWidth: number;
}

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  sourcePos: number;
  sourceNode: ProseMirrorNode;
  indicator: HTMLDivElement;
  chip: HTMLDivElement;
  frame: number;
}

export interface UseBlockPointerDragOptions {
  editor: Editor | null;
  getSourcePos: () => number | null;
  getScroller: () => HTMLElement | null;
  onBeforeActivate?: () => void;
  onActiveChange?: (active: boolean) => void;
}

/**
 * 顶层块指针拖拽。
 *
 * WKWebView 对 HTML5 拖放（dataTransfer/effectAllowed）的行为与 Chromium 不一致，
 * 官方 DragHandle 仅设置 view.dragging 时会出现“手柄能拖、正文不动”。这里不再依赖
 * 原生 DnD：手柄按下后由 pointer 事件计算落点并直接派发 ProseMirror 事务。
 */
export function useBlockPointerDrag({
  editor,
  getSourcePos,
  getScroller,
  onBeforeActivate,
  onActiveChange,
}: UseBlockPointerDragOptions) {
  const sessionRef = useRef<DragSession | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      teardownRef.current?.();
      teardownRef.current = null;
      sessionRef.current = null;
    },
    [],
  );

  const startPointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!editor || editor.isDestroyed || !editor.isEditable) return;
      if (event.button !== 0 || sessionRef.current) return;
      const sourcePos = getSourcePos();
      if (sourcePos === null || sourcePos < 0) return;
      const sourceNode = editor.state.doc.nodeAt(sourcePos);
      if (!sourceNode) return;

      event.preventDefault();
      event.stopPropagation();

      const grip = event.currentTarget;
      try {
        grip.setPointerCapture(event.pointerId);
      } catch {
        // 指针捕获不可用时窗口监听仍能继续收到事件。
      }

      const indicator = document.createElement("div");
      indicator.className = "editor-block-drop-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const chip = document.createElement("div");
      chip.className = "editor-block-drag-chip";
      chip.setAttribute("aria-hidden", "true");
      chip.textContent = blockTypeLabel(sourceNode.type.name);
      document.body.append(indicator, chip);

      const contentBox = measureEditorContentBox(editor);
      const session: DragSession = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        active: false,
        sourcePos,
        sourceNode,
        indicator,
        chip,
        frame: 0,
      };
      sessionRef.current = session;

      const updateChip = (x: number, y: number) => {
        const width = chip.offsetWidth || 64;
        const left = x + 16 + width > window.innerWidth ? x - width - 12 : x + 14;
        chip.style.transform = `translate3d(${left}px, ${y + 12}px, 0)`;
      };

      const computeDrop = (x: number, y: number): DropTarget | null => {
        const view = editor.view;
        const editorRect = view.dom.getBoundingClientRect();
        if (x < editorRect.left - 140 || x > editorRect.right + 140) return null;
        if (y < editorRect.top - 4 || y > editorRect.bottom + 4) return null;
        const doc = view.state.doc;
        let insertPos = doc.content.size;
        let lineTop = Number.NaN;
        let lastBottom = 0;
        let found = false;
        doc.forEach((_node, offset) => {
          const dom = view.nodeDOM(offset);
          if (!(dom instanceof HTMLElement)) return;
          const rect = dom.getBoundingClientRect();
          if (rect.height <= 0) return;
          lastBottom = rect.bottom;
          if (found) return;
          if (y < rect.top + rect.height / 2) {
            insertPos = offset;
            lineTop = rect.top;
            found = true;
          }
        });
        if (!found) {
          if (lastBottom === 0) return null;
          lineTop = lastBottom;
        }
        return {
          insertPos,
          lineTop: lineTop - 2,
          lineLeft: contentBox.left,
          lineWidth: contentBox.width,
        };
      };

      const applyDrop = (target: DropTarget | null) => {
        const noop =
          target !== null &&
          (target.insertPos === sourcePos || target.insertPos === sourcePos + sourceNode.nodeSize);
        if (!target || noop) {
          indicator.dataset.visible = "false";
          return;
        }
        indicator.dataset.visible = "true";
        indicator.style.top = `${target.lineTop}px`;
        indicator.style.left = `${target.lineLeft}px`;
        indicator.style.width = `${target.lineWidth}px`;
      };

      const scrollAtEdge = () => {
        const scroller = getScroller();
        if (!scroller) return;
        const rect = scroller.getBoundingClientRect();
        let delta = 0;
        if (session.lastY < rect.top + SCROLL_EDGE) {
          delta = -Math.ceil((rect.top + SCROLL_EDGE - session.lastY) / 4);
        } else if (session.lastY > rect.bottom - SCROLL_EDGE) {
          delta = Math.ceil((session.lastY - (rect.bottom - SCROLL_EDGE)) / 4);
        }
        if (delta === 0) return;
        scroller.scrollTop += Math.max(-SCROLL_STEP, Math.min(SCROLL_STEP, delta));
      };

      const tick = () => {
        if (sessionRef.current !== session || !session.active) return;
        scrollAtEdge();
        updateChip(session.lastX, session.lastY);
        applyDrop(computeDrop(session.lastX, session.lastY));
        session.frame = requestAnimationFrame(tick);
      };

      const blockNativeDrag = (dragEvent: DragEvent) => {
        dragEvent.preventDefault();
        dragEvent.stopImmediatePropagation();
      };

      const handleWindowBlur = () => finish(false);

      const finish = (commit: boolean) => {
        if (session.frame !== 0) cancelAnimationFrame(session.frame);
        session.frame = 0;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        window.removeEventListener("keydown", handleKeyDown, true);
        window.removeEventListener("blur", handleWindowBlur);
        document.removeEventListener("dragstart", blockNativeDrag, true);
        try {
          if (grip.hasPointerCapture(session.pointerId)) grip.releasePointerCapture(session.pointerId);
        } catch {
          // 指针已释放时忽略。
        }
        document.body.classList.remove("starris-block-dragging");
        indicator.remove();
        chip.remove();
        sessionRef.current = null;
        teardownRef.current = null;

        if (commit && session.active && !editor.isDestroyed) {
          const target = computeDrop(session.lastX, session.lastY);
          if (target) {
            moveTopLevelNode(editor, session.sourcePos, session.sourceNode, target.insertPos);
          }
        }
        if (session.active) {
          if (!editor.isDestroyed) {
            editor.view.dispatch(editor.state.tr.setMeta(BLOCK_DRAG_SOURCE_META, null));
          }
          onActiveChange?.(false);
        }
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== session.pointerId || sessionRef.current !== session) return;
        session.lastX = moveEvent.clientX;
        session.lastY = moveEvent.clientY;
        if (!session.active) {
          if (
            Math.hypot(moveEvent.clientX - session.startX, moveEvent.clientY - session.startY) <
            DRAG_THRESHOLD
          ) {
            return;
          }
          session.active = true;
          onBeforeActivate?.();
          onActiveChange?.(true);
          document.body.classList.add("starris-block-dragging");
          editor.view.dispatch(editor.state.tr.setMeta(BLOCK_DRAG_SOURCE_META, sourcePos));
          session.frame = requestAnimationFrame(tick);
        }
        moveEvent.preventDefault();
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== session.pointerId) return;
        session.lastX = upEvent.clientX;
        session.lastY = upEvent.clientY;
        finish(true);
      };

      const handlePointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== session.pointerId) return;
        finish(false);
      };

      const handleKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        finish(false);
      };

      updateChip(event.clientX, event.clientY);
      document.addEventListener("dragstart", blockNativeDrag, true);
      window.addEventListener("pointermove", handlePointerMove, { passive: false });
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      window.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("blur", handleWindowBlur);

      teardownRef.current = () => finish(false);
    },
    [editor, getScroller, getSourcePos, onActiveChange, onBeforeActivate],
  );

  return { startPointerDrag };
}
