/**
 * 标签页会话的纯计算：关闭与「跟随节点平表同步」。
 *
 * 抽成纯函数的原因：原先这两步在 `setTabs` 的更新函数里调 `setActiveTabId`，
 * 更新函数带副作用在 React 并发渲染/StrictMode 下会被重复执行；现在由调用方
 * 先用纯函数算好结果，再各自 setState，行为可用无窗口测试钉住。
 */

import type { NodeItem, TabItem } from "@/types/notebook";

/** 关闭标签页的计划；`activateId` 为 null 表示激活页不变。 */
export interface TabClosePlan {
  tabs: TabItem[];
  activateId: string | null;
}

/**
 * 计算关闭某个标签页后的标签组与激活页。
 *
 * 关闭的是激活页时按原索引顺延（越界取最后一个）；标签组清空后激活页为空串。
 * @param tabs 当前标签组
 * @param activeId 当前激活页 id
 * @param id 要关闭的标签页 id
 */
export function planCloseTab(tabs: TabItem[], activeId: string, id: string): TabClosePlan {
  const index = tabs.findIndex((tab) => tab.id === id);
  const next = tabs.filter((tab) => tab.id !== id);
  if (activeId !== id) return { tabs: next, activateId: null };
  return { tabs: next, activateId: next[Math.min(index, next.length - 1)]?.id ?? "" };
}

/** 标签组与节点平表同步的结果。 */
export interface TabSyncPlan {
  tabs: TabItem[];
  changed: boolean;
  /** null 表示激活页不需要调整 */
  activateId: string | null;
}

/**
 * 按最新节点平表同步标签：移除已删除节点与文件夹标签、跟随改名与类型变化。
 *
 * 没有实际变化时返回原数组引用，避免每次自动保存都触发标签组重渲染。
 * @param tabs 当前标签组
 * @param nodes 当前知识库平表节点
 * @param activeId 当前激活页 id
 */
export function planSyncTabs(tabs: TabItem[], nodes: NodeItem[], activeId: string): TabSyncPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let changed = false;
  const next: TabItem[] = [];
  for (const tab of tabs) {
    if (tab.nodeId === null) {
      next.push(tab);
      continue;
    }
    const node = byId.get(tab.nodeId);
    if (!node || node.kind === "folder") {
      changed = true;
      continue;
    }
    if (node.kind !== tab.kind || node.title !== tab.title) {
      changed = true;
      next.push({ ...tab, kind: node.kind, title: node.title });
    } else {
      next.push(tab);
    }
  }
  if (!changed) return { tabs, changed: false, activateId: null };
  const activeStillThere = next.some((tab) => tab.id === activeId);
  return {
    tabs: next,
    changed: true,
    activateId: activeStillThere ? null : (next[next.length - 1]?.id ?? ""),
  };
}
