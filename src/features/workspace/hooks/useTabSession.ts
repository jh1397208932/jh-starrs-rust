import { useCallback, useMemo, useState } from "react";
import type { NodeItem, TabItem } from "@/types/notebook";

/** 默认标签页：未命名画板 + 未命名文档，默认渲染文档视图 */
const DEFAULT_TABS: TabItem[] = [
  { id: "tab-board", kind: "board", title: "未命名画板", nodeId: null },
  { id: "tab-doc", kind: "doc", title: "未命名文档", nodeId: null },
];

/**
 * 标签页会话状态：标签组 / 激活页 / 开闭 / 收藏虚拟页。
 *
 * tab id 确定性派生（`tab-${node.id}`），无需在 updater 内读取旧状态；
 * 收藏列表虚拟页固定 id "tab-starred"。本 hook 不弹 toast（由调用方编排）。
 */
export function useTabSession() {
  const [tabs, setTabs] = useState<TabItem[]>(DEFAULT_TABS);
  const [activeTabId, setActiveTabId] = useState("tab-doc");

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);

  /** 打开树节点：已开过则仅激活，否则追加标签页 */
  const openNode = useCallback((node: NodeItem) => {
    const tabId = `tab-${node.id}`;
    setTabs((prev) =>
      prev.some((t) => t.id === tabId)
        ? prev
        : [...prev, { id: tabId, kind: node.kind, title: node.title, nodeId: node.id }],
    );
    setActiveTabId(tabId);
  }, []);

  /** 打开收藏列表虚拟页 */
  const showStarred = useCallback(() => {
    setTabs((prev) =>
      prev.some((t) => t.kind === "starred")
        ? prev
        : [...prev, { id: "tab-starred", kind: "starred", title: "收藏列表", nodeId: null }],
    );
    setActiveTabId("tab-starred");
  }, []);

  /**
   * 关闭标签页；关闭的是激活页时按原索引顺延激活，标签组清空后置空串（走空状态）。
   * @param id 目标标签页 id
   */
  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((cur) => (cur === id ? (next[Math.min(index, next.length - 1)]?.id ?? "") : cur));
      return next;
    });
  }, []);

  return { tabs, activeTabId, activeTab, openNode, closeTab, showStarred, setActiveTabId };
}
