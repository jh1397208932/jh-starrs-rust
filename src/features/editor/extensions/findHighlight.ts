//! 文档内查找：基于 ProseMirror 装饰的只读高亮，不修改正文与撤销栈。

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** 一处匹配的文档位置。 */
export interface FindMatch {
  from: number;
  to: number;
}

/** 查找插件状态。 */
export interface FindState {
  query: string;
  matches: FindMatch[];
  active: number;
}

/** 插件 key；组件用它读取当前匹配数。 */
export const findPluginKey = new PluginKey<FindState>("starrisFind");

interface FindMeta {
  query?: string;
  active?: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findHighlight: {
      /** 设置查找词并重算高亮。 */
      setFindQuery: (query: string) => ReturnType;
      /** 跳到下一处。 */
      findNext: () => ReturnType;
      /** 跳到上一处。 */
      findPrev: () => ReturnType;
      /** 清除高亮。 */
      clearFind: () => ReturnType;
    };
  }
}

function collectMatches(document: ProseMirrorNode, query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  document.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const haystack = node.text.toLowerCase();
    let offset = 0;
    while (offset <= haystack.length) {
      const index = haystack.indexOf(needle, offset);
      if (index < 0) break;
      matches.push({ from: position + index, to: position + index + needle.length });
      offset = index + Math.max(needle.length, 1);
    }
  });
  return matches;
}

/**
 * 文档查找扩展；插件状态保存 query/matches/active，UI 只读。
 */
export const FindHighlight = Extension.create({
  name: "findHighlight",

  addCommands() {
    return {
      setFindQuery:
        (query) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, { query, active: 0 } satisfies FindMeta);
          return true;
        },
      findNext:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, { active: Number.MAX_SAFE_INTEGER });
          return true;
        },
      findPrev:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, { active: -1 });
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findPluginKey, { query: "", active: 0 } satisfies FindMeta);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findPluginKey,
        state: {
          init: () => ({ query: "", matches: [], active: 0 }),
          apply(transaction, previous) {
            const meta = transaction.getMeta(findPluginKey) as FindMeta | undefined;
            const query = meta?.query ?? previous.query;
            const matches =
              transaction.docChanged || query !== previous.query
                ? collectMatches(transaction.doc, query)
                : previous.matches;
            let active = previous.active;
            if (meta?.active === Number.MAX_SAFE_INTEGER) {
              active = matches.length === 0 ? 0 : (previous.active + 1) % matches.length;
            } else if (meta?.active === -1) {
              active = matches.length === 0 ? 0 : (previous.active - 1 + matches.length) % matches.length;
            } else if (meta?.active !== undefined) {
              active = meta.active;
            }
            if (matches.length === 0) active = 0;
            else active = Math.min(Math.max(active, 0), matches.length - 1);
            return { query, matches, active };
          },
        },
        props: {
          decorations(state) {
            const find = findPluginKey.getState(state);
            if (!find || find.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === find.active ? "search-match search-match-active" : "search-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
