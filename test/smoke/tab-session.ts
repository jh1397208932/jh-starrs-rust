/**
 * 标签页会话纯逻辑测试（Node 运行，无需窗口）。
 *
 * 覆盖关闭标签的激活顺延，以及「跟随节点平表同步」的删除/改名/类型变化与引用稳定性。
 */

import { planCloseTab, planSyncTabs } from "@/features/workspace/utils/tabSession";
import type { NodeItem, TabItem } from "@/types/notebook";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

const tab = (id: string, kind: TabItem["kind"], title: string, nodeId: string | null): TabItem => ({
  id,
  kind,
  title,
  nodeId,
});

function node(id: string, kind: NodeItem["kind"], title: string): NodeItem {
  return {
    id,
    kbId: "kb-tabs0001",
    parentId: null,
    title,
    kind,
    level: 1,
    path: title,
    sortOrder: 0,
    starred: false,
    wordCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

const tabs = [
  tab("tab-a", "doc", "A", "a"),
  tab("tab-b", "doc", "B", "b"),
  tab("tab-c", "board", "C", "c"),
];

// 关闭非激活页：激活页不变。
{
  const plan = planCloseTab(tabs, "tab-b", "tab-a");
  assert(plan.tabs.length === 2 && plan.tabs[0]?.id === "tab-b", "关闭非激活页后其余顺序不变");
  assert(plan.activateId === null, "关闭非激活页不动激活页");
}
// 关闭激活的中间页：按原索引顺延。
{
  const plan = planCloseTab(tabs, "tab-b", "tab-b");
  assert(plan.activateId === "tab-c", `关闭中间激活页顺延到下一个（实际 ${plan.activateId}）`);
}
// 关闭激活的末页：回退到前一个。
{
  const plan = planCloseTab(tabs, "tab-c", "tab-c");
  assert(plan.activateId === "tab-b", `关闭末位激活页回退到前一个（实际 ${plan.activateId}）`);
}
// 关闭最后一个标签：激活页置空。
{
  const plan = planCloseTab([tab("tab-a", "doc", "A", "a")], "tab-a", "tab-a");
  assert(plan.tabs.length === 0 && plan.activateId === "", "关闭最后一个标签后激活页为空串");
}

// 同步：节点未变 → 保持原数组引用、不改激活页。
{
  const nodes = [node("a", "doc", "A"), node("b", "doc", "B"), node("c", "board", "C")];
  const plan = planSyncTabs(tabs, nodes, "tab-b");
  assert(plan.changed === false, "节点未变时 changed=false");
  assert(plan.tabs === tabs, "节点未变时复用原标签数组引用");
  assert(plan.activateId === null, "节点未变时不动激活页");
}
// 同步：节点删除 + 文件夹标签剔除，激活页被删则回退到最后一个。
{
  const nodes = [node("a", "doc", "A")];
  const plan = planSyncTabs(tabs, nodes, "tab-b");
  assert(plan.changed === true && plan.tabs.length === 1, "删除节点后只保留仍存在的标签");
  assert(plan.activateId === "tab-a", `激活页被删后回退到最后一个（实际 ${plan.activateId}）`);
}
// 同步：改名与类型变化跟随，未变的标签保持对象引用。
{
  const renamed = [node("a", "doc", "A"), node("b", "board", "B 改名"), node("c", "board", "C")];
  const plan = planSyncTabs(tabs, renamed, "tab-a");
  assert(plan.changed === true, "改名被识别为变化");
  assert(plan.tabs[0] === tabs[0], "未变的标签保持对象引用");
  assert(plan.tabs[1]?.title === "B 改名" && plan.tabs[1]?.kind === "board", "改名与类型变化已跟随");
  assert(plan.activateId === null, "激活页仍存在时不动");
}

console.log("标签页会话纯逻辑测试通过");
