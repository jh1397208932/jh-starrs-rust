/**
 * 按 id 打开已存在的树节点（文档内嵌块点击标题时使用）。
 *
 * 编辑器扩展在很深的 React 树里，直接传回调会击穿多层 memo；这里用一个
 * 单槽事件通道，由工作区布局层注册真正的标签打开动作。
 */

type NodeOpener = (nodeId: string) => void;

let opener: NodeOpener | null = null;

/** 注册打开动作；返回解绑函数。 */
export function registerNodeOpener(next: NodeOpener): () => void {
  opener = next;
  return () => {
    if (opener === next) opener = null;
  };
}

/** 请求打开某节点；没有注册者时静默忽略。 */
export function requestOpenNode(nodeId: string): void {
  if (!nodeId) return;
  opener?.(nodeId);
}
