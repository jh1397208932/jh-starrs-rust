/**
 * 画布视口效果：有保存记录就恢复上次位置，否则首次适配视图；搜索/导航时把目标主题居中。
 */

import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";
import type { MindmapLayout } from "@/types/mindmap";

export interface FlowViewportParams {
  /** 切换导图标签时重新初始化视口 */
  nodeId: string;
  initialViewport: { x: number; y: number; zoom: number } | null;
  focusTarget: { id: string; token: number } | null;
  layoutNodes: MindmapLayout["nodes"];
}

/** 注册视口相关副作用；不返回状态。 */
export function useMindmapFlowViewport({
  nodeId,
  initialViewport,
  focusTarget,
  layoutNodes,
}: FlowViewportParams) {
  const { fitView, setCenter, setViewport } = useReactFlow();
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (initializedForRef.current === nodeId) return;
    initializedForRef.current = nodeId;
    // 等一帧让 React Flow 量完节点尺寸，再决定恢复还是适配。
    const timer = window.setTimeout(() => {
      if (initialViewport) {
        void setViewport(initialViewport, { duration: 0 });
      } else {
        void fitView({ padding: 0.22, duration: 0 });
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [fitView, initialViewport, nodeId, setViewport]);

  useEffect(() => {
    if (!focusTarget) return;
    const node = layoutNodes.find((item) => item.id === focusTarget.id);
    if (!node) return;
    void setCenter(node.x + node.width / 2, node.y + node.height / 2, { zoom: 1.05, duration: 240 });
  }, [focusTarget, layoutNodes, setCenter]);
}
