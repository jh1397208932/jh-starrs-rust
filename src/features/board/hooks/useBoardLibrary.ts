import { useEffect, useMemo, useState } from "react";
import { logInfo } from "@/lib/logger";
import type { LibraryItem } from "@/types/library";
import { BUILTIN_COMPONENTS, describeLibraryItem, type LibraryCategoryId } from "../libraryCatalog";

export interface BoardLibraryEntry {
  key: string;
  name: string;
  category: LibraryCategoryId;
  section: string;
  elements: readonly unknown[];
  source: "builtin" | "library";
}

const builtinElements = new Map<string, readonly unknown[]>();
let builtinLoad: Promise<void> | null = null;

function loadBuiltinElements(): Promise<void> {
  if (!builtinLoad) {
    builtinLoad = import("@excalidraw/excalidraw").then(({ convertToExcalidrawElements }) => {
      for (const component of BUILTIN_COMPONENTS) {
        if (builtinElements.has(component.key)) continue;
        builtinElements.set(
          component.key,
          convertToExcalidrawElements(component.skeletons as never, { regenerateIds: true }),
        );
      }
    });
  }
  return builtinLoad;
}

/** 合并内置组件与用户导入库；启用中的预设库不重复展示。 */
export function useBoardLibraryEntries(items: LibraryItem[] | null) {
  const [ready, setReady] = useState(builtinElements.size === BUILTIN_COMPONENTS.length);

  useEffect(() => {
    let cancelled = false;
    void loadBuiltinElements()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => {
    const result: BoardLibraryEntry[] = [];
    if (ready) {
      for (const component of BUILTIN_COMPONENTS) {
        const elements = builtinElements.get(component.key);
        if (!elements || elements.length === 0) continue;
        result.push({
          key: component.key,
          name: component.name,
          category: component.category,
          section: component.section,
          elements,
          source: "builtin",
        });
      }
    }
    const libraries = items ?? [];
    const ordered = [
      ...libraries.filter((item) => item.librarySourceType === "import"),
      ...libraries.filter((item) => item.librarySourceType !== "import"),
    ];
    for (const item of ordered) {
      const elements = Array.isArray(item.elements) ? item.elements : [];
      if (elements.length === 0) continue;
      result.push({
        key: `library:${item.id}`,
        name: item.name.trim() || describeLibraryItem(elements),
        category: "mine",
        section: item.libraryName || "组件库",
        elements,
        source: "library",
      });
    }
    return result;
  }, [items, ready]);

  return { entries, loading: items === null || !ready };
}

/** 缩略图逐张生成；超过这个图元数的组件只截取前 N 个图元预览，避免一个复杂库把主线程拖死。 */
const MAX_PREVIEW_ELEMENTS = 80;
/** 每帧最多花在缩略图上的毫秒数；用完就让出一帧，保证滚动不掉帧。 */
const PREVIEW_FRAME_BUDGET_MS = 8;
/** 缩略图缓存条数上限（注入顺序即最旧）；反复导入/删除组件库时不无限增长。 */
const PREVIEW_CACHE_MAX = 2_000;
const previewCache = new Map<string, string>();
const previewJobs = new Map<string, Array<(url: string) => void>>();
const previewQueue: BoardLibraryEntry[] = [];
let previewPumping = false;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16);
    schedule(() => resolve());
  });
}

/**
 * 单张缩略图；同一帧里按时间预算连做多张，用完预算再让出一帧。
 *
 * 旧实现每张之间固定让出 16ms：20 张卡片光等待就 300ms 起步，
 * 用户看到的就是"先空图标、过一会才出图"。
 */
async function pumpLibraryPreviews() {
  if (previewPumping) return;
  previewPumping = true;
  const startedAt = performance.now();
  let produced = 0;
  try {
    const { exportToSvg } = await import("@excalidraw/excalidraw");
    while (previewQueue.length > 0) {
      const frameStartedAt = performance.now();
      while (previewQueue.length > 0 && performance.now() - frameStartedAt < PREVIEW_FRAME_BUDGET_MS) {
        const entry = previewQueue.shift();
        if (!entry) continue;
        const waiters = previewJobs.get(entry.key);
        if (!waiters) continue;
        let url = "";
        try {
          const svg = await exportToSvg({
            elements: entry.elements.slice(0, MAX_PREVIEW_ELEMENTS) as never,
            appState: {
              exportBackground: false,
              viewBackgroundColor: "transparent",
              exportPadding: 8,
              exportScale: 1,
            } as never,
            files: {},
          });
          const markup = new XMLSerializer().serializeToString(svg);
          url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
        } catch {
          url = "";
        }
        previewCache.set(entry.key, url);
        while (previewCache.size > PREVIEW_CACHE_MAX) {
          const oldest = previewCache.keys().next().value;
          if (oldest === undefined) break;
          previewCache.delete(oldest);
        }
        previewJobs.delete(entry.key);
        for (const resolve of waiters) resolve(url);
        produced += 1;
      }
      await nextFrame();
    }
  } finally {
    previewPumping = false;
    if (produced > 0) {
      logInfo("perf.library", `previews=${produced} total=${Math.round(performance.now() - startedAt)}ms`);
    }
  }
}

/** 请求一张缩略图；命中缓存直接返回。 */
function requestLibraryPreview(entry: BoardLibraryEntry): Promise<string> {
  const cached = previewCache.get(entry.key);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = previewJobs.get(entry.key);
  if (existing) {
    return new Promise((resolve) => {
      existing.push(resolve);
    });
  }
  const promise = new Promise<string>((resolve) => {
    previewJobs.set(entry.key, [resolve]);
  });
  previewQueue.push(entry);
  void pumpLibraryPreviews();
  return promise;
}

/**
 * 预热缩略图：面板一打开就把待生成的条目排进队列，翻到哪一类都已经有图。
 * @param entries 需要预热的条目（调用方按"当前分类优先"排好序）
 */
export function prefetchLibraryPreviews(entries: BoardLibraryEntry[]): void {
  let queued = false;
  for (const entry of entries) {
    if (previewCache.has(entry.key) || previewJobs.has(entry.key)) continue;
    previewJobs.set(entry.key, []);
    previewQueue.push(entry);
    queued = true;
  }
  if (queued) void pumpLibraryPreviews();
}

/** 缩略图读取结果：pending 表示还在生成（用于显示骨架而不是空图标）。 */
export interface LibraryPreviewResult {
  url: string;
  pending: boolean;
}

/** 卡片进入视口后才请求缩略图；同一张图跨标签页复用。 */
export function useLibraryPreview(entry: BoardLibraryEntry, enabled: boolean): LibraryPreviewResult {
  const [url, setUrl] = useState(() => previewCache.get(entry.key) ?? "");

  useEffect(() => {
    if (!enabled || url || previewCache.has(entry.key)) return;
    let cancelled = false;
    void requestLibraryPreview(entry).then((value) => {
      if (!cancelled) setUrl(value);
    });
    // 离开视口不取消任务：生成结果会进缓存，滚回来时直接命中；
    // 取消会让"滚动 → 回滚"重复付一次导出成本。
    return () => {
      cancelled = true;
    };
  }, [enabled, entry, url]);

  return { url, pending: enabled && !url && !previewCache.has(entry.key) };
}
