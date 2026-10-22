import { useCallback, useMemo, useState } from "react";
import type { NodeItem, TabItem } from "@/types/notebook";

/**
 * 标签页会话状态：标签组 / 激活页 / 开闭 / 收藏虚拟页。
 *
 * tab id 确定性派生（`tab-${node.id}`），无需在 updater 内读取旧状态；
 * 收藏列表虚拟页固定 id "tab-starred"。本 hook 不弹 toast（由调用方编排）。
 */
export function useTabSession() {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeTabId, setActiveTabId] = useState("");

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [tabs, activeTabId]);

  /** 打开树节点：文件夹不打开；已开过则仅激活，否则追加标签页 */
  const openNode = useCallback((node: NodeItem) => {
    const kind = node.kind;
    if (kind === "folder") return;
    const tabId = `tab-${node.id}`;
    setTabs((prev) =>
      prev.some((tab) => tab.id === tabId)
        ? prev
        : [...prev, { id: tabId, kind, title: node.title, nodeId: node.id }],
    );
    setActiveTabId(tabId);
  }, []);

  /** 打开收藏列表虚拟页 */
  const showStarred = useCallback(() => {
    setTabs((prev) =>
      prev.some((tab) => tab.kind === "starred")
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
      const index = prev.findIndex((tab) => tab.id === id);
      const next = prev.filter((tab) => tab.id !== id);
      setActiveTabId((current) =>
        current === id ? (next[Math.min(index, next.length - 1)]?.id ?? "") : current,
      );
      return next;
    });
  }, []);

  /**
   * 与最新节点列表同步：移除已删除节点标签、更新改名后的标题、剔除文件夹标签。
   * @param nodes 当前知识库平表节点
   */
  const syncTabs = useCallback((nodes: NodeItem[]) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    setTabs((prev) => {
      const next = prev.flatMap<TabItem>((tab) => {
        if (tab.nodeId === null) return [tab];
        const node = byId.get(tab.nodeId);
        if (!node) return [];
        const kind = node.kind;
        if (kind === "folder") return [];
        return [{ ...tab, kind, title: node.title }];
      });
      setActiveTabId((current) =>
        next.some((tab) => tab.id === current) ? current : (next[next.length - 1]?.id ?? ""),
      );
      return next;
    });
  }, []);

  /** 切换工作区/知识库时清空标签，避免跨库引用。 */
  const resetTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId("");
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab,
    openNode,
    closeTab,
    showStarred,
    setActiveTabId,
    syncTabs,
    resetTabs,
  };
}
