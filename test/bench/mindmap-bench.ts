/**
 * 思维导图纯函数基准：布局与树命令，在 Node 中直接测量算法成本。
 *
 * 说明：measureTopic 依赖 canvas 文本测量，这里用固定宽度的桩代替，
 * 因此本基准只代表树/布局的算法成本，不代表真实浏览器渲染耗时。
 */

import { layoutMindmap } from "@/features/mindmap/utils/layout";
import { clearMeasureCache } from "@/features/mindmap/utils/measure";
import {
  addChild,
  countTopics,
  findTopic,
  moveSibling,
  updateTopic,
} from "@/features/mindmap/utils/tree";
import type { MindmapContent, MindmapTopic } from "@/types/mindmap";

function stubDom(): void {
  // measure.ts 用隐藏 span 量宽；这里给一个按字符数估算的桩。
  let lastText = "";
  const probe = {
    style: {} as Record<string, string>,
    set textContent(value: string) {
      lastText = value;
    },
    get offsetWidth() {
      return lastText.length * 9;
    },
  };
  globalThis.document = {
    createElement: () => probe,
    body: { appendChild: () => undefined },
  } as unknown as Document;
  globalThis.getComputedStyle = (() => ({ fontFamily: "stub-font" })) as unknown as typeof getComputedStyle;
}

function makeText(index: number): string {
  const words = ["产品规划", "里程碑", "风险与依赖", "评审要点", "资源池", "交付验收"];
  return `${words[index % words.length]} ${String(index % 1000).padStart(3, "0")} 要点补充`;
}

/** 生成一棵近似 XMind 常见形态的树：广度 3–4 层层展开，深度约 log(total)。 */
function buildTree(rootId: string, total: number): MindmapTopic {
  let next = 0;
  const root: MindmapTopic = { id: rootId, text: makeText(next++), children: [] };
  const queue: MindmapTopic[] = [root];
  while (next < total) {
    const topic = queue.shift();
    if (!topic) break;
    const breadth = topic.text.length % 2 === 0 ? 3 : 4;
    const children: MindmapTopic[] = [];
    for (let index = 0; index < breadth && next < total; index += 1) {
      const child: MindmapTopic = {
        id: `${topic.id}-${index}`,
        text: makeText(next++),
        children: [],
      };
      children.push(child);
      queue.push(child);
    }
    topic.children = children;
  }
  return root;
}

function makeContent(structure: MindmapContent["sheet"]["structure"], total: number): MindmapContent {
  return {
    schemaVersion: 2,
    sheet: {
      id: "bench-sheet",
      structure,
      theme: "auto",
      root: buildTree("topic-root", total),
    },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function bench(label: string, runs: number, fn: () => void): void {
  for (let index = 0; index < Math.min(5, runs); index += 1) fn();
  const samples: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  console.log(
    `${label}: 中位 ${median(samples).toFixed(3)} ms · p95 ${p95(samples).toFixed(3)} ms · ${runs} 次`,
  );
}

function main(): void {
  stubDom();
  for (const total of [1_000, 5_000]) {
    console.log(`\n=== ${total} 主题 ===`);
    const content = makeContent("balanced", total);
    console.log(`实际主题数 ${countTopics(content.sheet.root)}`);
    clearMeasureCache();
    bench(`布局 · balanced`, 20, () => layoutMindmap(content));
    bench(`布局 · logic-right`, 20, () => {
      layoutMindmap({ ...content, sheet: { ...content.sheet, structure: "logic-right" } });
    });
    bench(`布局 · org-down`, 20, () => {
      layoutMindmap({ ...content, sheet: { ...content.sheet, structure: "org-down" } });
    });

    const target = findTopic(content.sheet.root, "topic-root-0-0-0");
    if (!target) throw new Error("基准目标主题不存在");
    bench(`更新文本单次`, 100, () => {
      updateTopic(content, target.id, (topic) => ({ ...topic, text: `${topic.text}!` }));
    });
    bench(`新增子主题单次`, 100, () => {
      addChild(content, target.id, { id: `bench-${Math.random()}`, text: "", children: [] });
    });
    bench(`同级移动单次`, 100, () => {
      moveSibling(content, target.id, 1);
    });
    const start = performance.now();
    for (let index = 0; index < 10; index += 1) JSON.stringify(content);
    console.log(`JSON.stringify 整树: 中位 ${((performance.now() - start) / 10).toFixed(3)} ms`);
  }
}

main();
