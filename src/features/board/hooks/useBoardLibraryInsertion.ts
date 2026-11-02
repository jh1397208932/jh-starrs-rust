/**
 * 画板组件插入：恢复图元、重映射 id/分组/绑定；点击落中心，拖拽按指针落点。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { t } from "@/lib/i18n";
import type { BoardCanvasApi } from "@/types/board";
import type { BoardLibraryEntry } from "./useBoardLibrary";

interface DragGhost {
  x: number;
  y: number;
  entry: BoardLibraryEntry;
}

export interface BoardLibraryInsertionController {
  /** 正在插入的条目 key；卡片显示加载遮罩 */
  insertingKey: string | null;
  /** 指针位于画布上方时显示落点框 */
  dropActive: boolean;
  /** 拖拽时跟随指针的名称幽灵 */
  dragGhost: DragGhost | null;
  /** 点击卡片插入到视口中心 */
  insertFromLibrary: (entry: BoardLibraryEntry) => Promise<void>;
  /** 卡片指针按下；移动超过阈值转为拖拽 */
  handlePointerDown: (event: React.PointerEvent<HTMLButtonElement>, entry: BoardLibraryEntry) => void;
}

/**
 * 组件库插入控制器。
 * @param api Excalidraw 公共 API；未加载完成时为 null
 * @param onError 插入或拖拽失败提示
 * @returns 插入状态与指针处理器
 */
export function useBoardLibraryInsertion(
  api: BoardCanvasApi | null,
  onError: (message: string) => void,
): BoardLibraryInsertionController {
  const [insertingKey, setInsertingKey] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
  const suppressClickRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const insertIndexRef = useRef(0);

  const insertEntry = useCallback(
    async (entry: BoardLibraryEntry, origin?: { x: number; y: number }) => {
      if (!api) throw new Error(t("画板尚未加载完成"));
      const { restoreElements } = await import("@excalidraw/excalidraw");
      const restored = restoreElements(entry.elements as never, null, { repairBindings: true });
      if (restored.length === 0) throw new Error(t("组件为空"));
      const appState = api.getAppState();
      // 连续点击插入时按 48px 阶梯错开，避免多个组件精确叠在画布中心。
      const cascade = origin ? 0 : (insertIndexRef.current % 5) * 48;
      if (!origin) insertIndexRef.current += 1;
      const centerX = origin?.x ?? appState.width / (2 * appState.zoom.value) - appState.scrollX + cascade;
      const centerY = origin?.y ?? appState.height / (2 * appState.zoom.value) - appState.scrollY + cascade;
      const minX = Math.min(...restored.map((element) => element.x));
      const minY = Math.min(...restored.map((element) => element.y));
      const maxX = Math.max(...restored.map((element) => element.x + element.width));
      const maxY = Math.max(...restored.map((element) => element.y + element.height));
      const offsetX = centerX - (minX + maxX) / 2;
      const offsetY = centerY - (minY + maxY) / 2;
      // 旧组件库可能在一个组件里重复使用同一个 id；逐元素换发新 id，避免场景里出现重复身份。
      const idMap = new Map<string, string>();
      for (const element of restored) {
        if (!idMap.has(element.id)) idMap.set(element.id, crypto.randomUUID());
      }
      const usedIds = new Set<string>();
      const nextElementId = (oldId: string) => {
        let mapped = idMap.get(oldId) ?? crypto.randomUUID();
        if (usedIds.has(mapped)) mapped = crypto.randomUUID();
        usedIds.add(mapped);
        return mapped;
      };
      const groupMap = new Map<string, string>();
      const mapGroup = (groupId: string) => {
        const mapped = groupMap.get(groupId) ?? crypto.randomUUID();
        groupMap.set(groupId, mapped);
        return mapped;
      };
      type BindingView = (typeof restored)[number] & {
        containerId?: string | null;
        frameId?: string | null;
        startBinding?: { elementId?: string } | null;
        endBinding?: { elementId?: string } | null;
      };
      const elements = restored.map((element) => {
        const source = element as unknown as BindingView;
        const clone = structuredClone(element) as Record<string, unknown>;
        clone.id = nextElementId(element.id);
        clone.versionNonce = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
        clone.seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
        clone.updated = Date.now();
        clone.x = element.x + offsetX;
        clone.y = element.y + offsetY;
        clone.groupIds = element.groupIds.map(mapGroup);
        if (source.containerId && idMap.has(source.containerId)) {
          clone.containerId = idMap.get(source.containerId);
        }
        if (source.frameId && idMap.has(source.frameId)) {
          clone.frameId = idMap.get(source.frameId);
        }
        if (element.boundElements) {
          clone.boundElements = element.boundElements.map((bound) => ({
            ...bound,
            id: idMap.get(bound.id) ?? bound.id,
          }));
        }
        if (source.startBinding?.elementId && idMap.has(source.startBinding.elementId)) {
          clone.startBinding = {
            ...source.startBinding,
            elementId: idMap.get(source.startBinding.elementId),
          };
        }
        if (source.endBinding?.elementId && idMap.has(source.endBinding.elementId)) {
          clone.endBinding = {
            ...source.endBinding,
            elementId: idMap.get(source.endBinding.elementId),
          };
        }
        return clone;
      });
      api.updateScene({ elements: [...api.getSceneElements(), ...elements] });
    },
    [api],
  );

  /** 点击插入；拖拽结束后的 click 不重复插入。 */
  const insertFromLibrary = useCallback(
    async (entry: BoardLibraryEntry) => {
      if (suppressClickRef.current === entry.key) {
        suppressClickRef.current = null;
        return;
      }
      setInsertingKey(entry.key);
      try {
        await insertEntry(entry);
      } catch (error) {
        onError(toErrorMessage(error));
      } finally {
        setInsertingKey(null);
      }
    },
    [insertEntry, onError],
  );

  useEffect(() => () => dragCleanupRef.current?.(), []);

  /** 卡片按下后按指针位移区分点击与拖拽；拖到画布按落点插入。 */
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, entry: BoardLibraryEntry) => {
      if (event.button !== 0) return;
      suppressClickRef.current = null;
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;

      const cleanup = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        dragCleanupRef.current = null;
        setDragGhost(null);
        setDropActive(false);
      };

      const move = (moveEvent: PointerEvent) => {
        if (!active && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 6) {
          return;
        }
        active = true;
        moveEvent.preventDefault();
        setDragGhost({ x: moveEvent.clientX, y: moveEvent.clientY, entry });
        const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        setDropActive(Boolean(target?.closest(".board-excalidraw")));
      };

      const finish = (upEvent: PointerEvent, cancelled: boolean) => {
        cleanup();
        if (!active) return;
        suppressClickRef.current = entry.key;
        if (cancelled || !api) return;
        const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        if (!target?.closest(".board-excalidraw")) return;
        void (async () => {
          try {
            const { viewportCoordsToSceneCoords } = await import("@excalidraw/excalidraw");
            const point = viewportCoordsToSceneCoords(
              { clientX: upEvent.clientX, clientY: upEvent.clientY },
              api.getAppState() as never,
            );
            await insertEntry(entry, point);
          } catch (error) {
            onError(toErrorMessage(error));
          }
        })();
      };

      const up = (upEvent: PointerEvent) => finish(upEvent, false);
      const cancel = (upEvent: PointerEvent) => finish(upEvent, true);

      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      dragCleanupRef.current = cleanup;
    },
    [api, insertEntry, onError],
  );

  return { insertingKey, dropActive, dragGhost, insertFromLibrary, handlePointerDown };
}
