import { useCallback, useMemo, useState } from "react";
import { t } from "@/lib/i18n";
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
        : [...prev, { id: "tab-starred", kind: "starred", title: t("收藏列表"), nodeId: null }],
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
   * 无实际变化时保持原数组引用，避免每次自动保存都触发标签组重渲染（2026-10-27 性能任务 B2）。
   * @param nodes 当前知识库平表节点
   */
  const syncTabs = useCallback((nodes: NodeItem[]) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    setTabs((prev) => {
      let changed = false;
      const next: TabItem[] = [];
      for (const tab of prev) {
        if (tab.nodeId === null) {
          next.push(tab);
          continue;
        }
        const node = byId.get(tab.nodeId);
        if (!node) {
          changed = true;
          continue;
        }
        if (node.kind === "folder") {
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
      if (!changed) return prev;
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
