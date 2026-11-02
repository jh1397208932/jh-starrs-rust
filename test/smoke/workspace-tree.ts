/**
 * 文件树构建纯逻辑烟雾测试（Node 运行，无需窗口）。
 *
 * 覆盖 `buildTree(nodes, previous)` 的子数组复用路径：自动保存只会替换被保存节点的
 * 对象身份，其余节点保持同一实例，因此「复用旧 TreeNode」分支是每次保存都会走的热点。
 * 该分支一旦把子项重复灌进复用数组，侧栏行数就随保存次数单调增长，最终吃满主线程。
 */

import { buildTree } from "@/features/workspace/utils/tree";
import type { NodeItem, TreeNode } from "@/types/notebook";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exit(1);
  }
  console.log(`ok ${message}`);
}

/** 构造一条「文件夹 → 子文件夹 → 文档」的三层链，另挂一个同级文档，覆盖复用与新建两种分支。 */
function node(
  id: string,
  parentId: string | null,
  kind: NodeItem["kind"],
  title: string,
  sortOrder: number,
  updatedAt: number,
): NodeItem {
  return {
    id,
    kbId: "kb-smoke0001",
    parentId,
    title,
    kind,
    level: parentId ? 3 : 1,
    path: title,
    sortOrder,
    starred: false,
    wordCount: 0,
    createdAt: 1,
    updatedAt,
  };
}

/** 递归展平整棵树，用于统计行数与重复 id。 */
function flatten(tree: TreeNode[]): NodeItem[] {
  const rows: NodeItem[] = [];
  const walk = (entries: TreeNode[]) => {
    for (const entry of entries) {
      rows.push(entry.node);
      walk(entry.children);
    }
  };
  walk(tree);
  return rows;
}

function initialNodes(updatedAt: number): NodeItem[] {
  return [
    node("node-root", null, "folder", "根文件夹", 0, updatedAt),
    node("node-child", "node-root", "folder", "子文件夹", 0, updatedAt),
    node("node-doc", "node-child", "doc", "文档", 0, updatedAt),
    node("node-sibling", "node-root", "mindmap", "思维导图", 1, updatedAt),
  ];
}

/** 模拟 useWorkspaceStore.applyNodes：保存只换被改那条的对象身份，其余原样复用。 */
function savedOnce(nodes: NodeItem[], savedId: string, timestamp: number): NodeItem[] {
  return nodes.map((item) => (item.id === savedId ? { ...item, updatedAt: timestamp } : item));
}

let currentNodes = initialNodes(1000);
let previous = buildTree(currentNodes);
const siblingInstance =
  previous
    .find((entry) => entry.node.id === "node-root")
    ?.children.find((entry) => entry.node.id === "node-sibling") ?? null;

assert(flatten(previous).length === currentNodes.length, "首次构建行数等于节点数");

for (let round = 1; round <= 4; round += 1) {
  // 保存的是「子文件夹里的文档」：改动节点的祖先必须换新实例（不可变树的语义），
  // 但不在改动路径上的兄弟子树必须原样复用，否则行级 memo 会被每次保存击穿。
  const nextNodes = savedOnce(currentNodes, "node-doc", 1000 + round);
  const built = buildTree(nextNodes, previous);
  const rows = flatten(built);
  const ids = new Set(rows.map((row) => row.id));

  assert(
    rows.length === currentNodes.length,
    `第 ${round} 次保存后行数仍为 ${currentNodes.length}（实际 ${rows.length}，id 去重后 ${ids.size}）`,
  );
  assert(rows.length === ids.size, `第 ${round} 次保存后没有重复 id（实际 ${rows.length - ids.size} 条重复）`);
  assert(
    flatten(previous).length === currentNodes.length,
    `第 ${round} 次保存后上一轮的树未被就地改写（实际 ${flatten(previous).length}）`,
  );

  const reusedSibling = built
    .find((entry) => entry.node.id === "node-root")
    ?.children.find((entry) => entry.node.id === "node-sibling");
  assert(
    reusedSibling !== undefined && reusedSibling === siblingInstance,
    `第 ${round} 次保存后未受影响的兄弟子树复用同一 TreeNode 实例`,
  );

  currentNodes = nextNodes;
  previous = built;
}

// 保存根级的直接子节点时，另一棵子树（含其孙节点）应整体保持实例不变。
const beforeOther = previous.find((entry) => entry.node.id === "node-root")?.children ?? [];
const savedRootChild = buildTree(savedOnce(currentNodes, "node-sibling", 2000), previous);
const afterOther = savedRootChild.find((entry) => entry.node.id === "node-root")?.children ?? [];
assert(
  afterOther.length === beforeOther.length &&
    afterOther.every((entry, index) => entry === beforeOther[index] || entry.node.id === "node-sibling"),
  `改同级节点时兄弟子树整体复用（共 ${afterOther.length} 个同级条目）`,
);
const docSubtree = afterOther.find((entry) => entry.node.id === "node-child") ?? null;
const docSubtreeBefore = beforeOther.find((entry) => entry.node.id === "node-child") ?? null;
assert(
  docSubtree !== null && docSubtree === docSubtreeBefore,
  "改同级节点时更深一层未变子树也复用同一 TreeNode 实例",
);

console.log("文件树构建烟雾测试通过");

// 宽树：300 个同级子项，验证装配/排序/复用不在数量上放大问题。
const wideParent = node("wide-root", null, "folder", "宽树", 0, 1000);
const wideNodes = [
  wideParent,
  ...Array.from({ length: 300 }, (_, index) =>
    node(
      `wide-leaf-${index}`,
      "wide-root",
      "doc",
      `leaf-${String(index).padStart(3, "0")}`,
      index,
      1000,
    ),
  ),
];
const wideTree = buildTree(wideNodes);
assert(flatten(wideTree).length === 301, "宽树行数 == 300 子项 + 父级");
assert(wideTree[0].children.length === 300, "父级下恰好 300 个子项");
assert(wideTree[0].children[0].node.title === "leaf-000", "宽树按 sortOrder 升序");
assert(wideTree[0].children[299].node.title === "leaf-299", "宽树末位子项存在");
assert(new Set(flatten(wideTree).map((item) => item.id)).size === 301, "宽树无重复 id");

// 保存中间一个子项后重建：行数不变，未变的兄弟保持实例；被改节点的父级换新实例。
const wideSaved = savedOnce(wideNodes, "wide-leaf-150", 2000);
const wideRebuilt = buildTree(wideSaved, wideTree);
assert(flatten(wideRebuilt).length === 301, "宽树重建后行数不变");
assert(wideRebuilt[0] !== wideTree[0], "被改子项的父级应换新实例");
assert(wideRebuilt[0].children[0] === wideTree[0].children[0], "未变的兄弟保持同一实例");
