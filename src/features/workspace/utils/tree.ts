import type { NodeItem, TreeEntry } from "@/types/notebook";

/** 展平文档树：文件夹展开为子节点，单层节点原样保留 */
export function flattenTree(entries: TreeEntry[]): NodeItem[] {
  return entries.flatMap((e) => (e.kind === "folder" ? e.children : [e]));
}

/**
 * 按 id 查找节点：先查单层节点，再逐文件夹查子项。
 * @returns 命中的节点；未找到返回 null
 */
export function findNode(entries: TreeEntry[], id: string): NodeItem | null {
  for (const entry of entries) {
    if (entry.kind !== "folder" && entry.id === id) return entry;
    if (entry.kind === "folder") {
      const hit = entry.children.find((n) => n.id === id);
      if (hit) return hit;
    }
  }
  return null;
}
