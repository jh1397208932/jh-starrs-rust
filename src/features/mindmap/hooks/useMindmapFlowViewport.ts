/**
 * 画布视口效果：恢复上次位置、首次适配；显式导航时才重新居中。
 *
 * 面板改为浮层后画布尺寸基本不变；窗口/侧栏尺寸变化时，若用户没有手动平移，
 * 自动重新适配，保证根主题始终在可视区域中心（问题 15）。
 */

import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef } from "react";
import type { MindmapLayout } from "@/types/mindmap";

export interface FlowViewportParams {
  /** 切换导图标签时重新初始化视口 */
  nodeId: string;
  initialViewport: { x: number; y: number; zoom: number } | null;
  focusTarget: { id: string; token: number } | null;
  layoutNodes: MindmapLayout["nodes"];
  /** 画布容器；用于监听尺寸变化 */
  containerRef: React.RefObject<HTMLDivElement | null>;
}

/** 注册视口相关副作用；返回用户交互标记与手动重新适配。 */
export function useMindmapFlowViewport({
  nodeId,
  initialViewport,
  focusTarget,
  layoutNodes,
  containerRef,
}: FlowViewportParams) {
  const { fitView, getNodes, getViewport, setCenter, setViewport } = useReactFlow();
  const initializedForRef = useRef<string | null>(null);
  const layoutRef = useRef(layoutNodes);
  layoutRef.current = layoutNodes;
  const userMovedRef = useRef(false);

  useEffect(() => {
    if (initializedForRef.current === nodeId) return;
    userMovedRef.current = false;
    let frame = 0;
    let attempts = 0;
    // 等 React Flow 量出节点尺寸再适配：测量完成前 fitView 可能得不到包围盒，
    // 视口会停在 (0,0,1)，新导图的根主题就落在画布左上角（问题 15）。
    const apply = () => {
      frame = window.requestAnimationFrame(() => {
        const nodes = getNodes();
        const measured = nodes.length > 0 && nodes.every((node) => Boolean(node.measured?.width));
        if (!measured && attempts < 90) {
          attempts += 1;
          apply();
          return;
        }
        initializedForRef.current = nodeId;
        if (initialViewport) {
          void setViewport(initialViewport, { duration: 0 });
          return;
        }
        const before = getViewport();
        // 单节点图 fitView 会放大到 maxZoom 上限；限制为 100%，保持与阅读字号一致。
        void fitView({ padding: 0.28, duration: 0, maxZoom: 1 }).then((done) => {
          const after = getViewport();
          const unchanged =
            Math.abs(after.x - before.x) < 1 &&
            Math.abs(after.y - before.y) < 1 &&
            Math.abs(after.zoom - before.zoom) < 0.001;
          if (done && !unchanged) return;
          // 单节点或包围盒缺失时 fitView 会空转，直接以根主题为中心兜底。
          const root = layoutRef.current.find((node) => node.depth === 0);
          if (root) {
            void setCenter(root.x + root.width / 2, root.y + root.height / 2, {
              zoom: 1,
              duration: 0,
            });
          }
        });
      });
    };
    apply();
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, getNodes, getViewport, initialViewport, nodeId, setCenter, setViewport]);

  // 只响应显式导航（搜索/方向键/大纲双击）：布局变化不重新居中，避免操作时跳动。
  useEffect(() => {
    if (!focusTarget) return;
    const node = layoutRef.current.find((item) => item.id === focusTarget.id);
    if (!node) return;
    userMovedRef.current = true;
    // 固定 100%：1.05 这类非整数缩放会让整屏文字按非整数设备像素重采样，看起来发虚。
    void setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1, duration: 240 });
  }, [focusTarget, setCenter]);

  const markUserMoved = useCallback(() => {
    userMovedRef.current = true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let width = container.clientWidth;
    let height = container.clientHeight;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const nextWidth = container.clientWidth;
      const nextHeight = container.clientHeight;
      if (Math.abs(nextWidth - width) < 2 && Math.abs(nextHeight - height) < 2) return;
      width = nextWidth;
      height = nextHeight;
      if (userMovedRef.current) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void fitView({ padding: 0.28, duration: 160, maxZoom: 1 });
      });
    });
    observer.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [containerRef, fitView]);

  return { markUserMoved };
}
