/**
 * 回车新块清理行内样式。
 *
 * Tiptap 官方扩展写法：`addKeyboardShortcuts` 拦截 Enter，按当前结构选择
 * `splitListItem` 或 `splitBlock` 完成拆分，再清空 storedMarks，让新块从
 * “无样式”开始输入。空列表项/空引用交给默认行为退出结构；代码块、表格、
 * 折叠块标题不拦截。
 */

import { type CommandProps, type Editor, Extension } from "@tiptap/core";

/** 这些节点内按 Enter 保持官方默认行为（换行/跳格/新建段落）。 */
const EXEMPT_PARENTS = new Set(["codeBlock", "tableCell", "tableHeader", "detailsSummary"]);

/** 空块位于这些容器时，Enter 默认会退出结构，不能被拦截。 */
const STRUCTURAL_ANCESTORS = new Set([
  "listItem",
  "taskItem",
  "blockquote",
  "detailsContent",
  "tableCell",
  "tableHeader",
]);

/** 清空 storedMarks 的官方 command；只影响当前事务，不改已有文本。 */
function clearStoredMarks({ tr, dispatch }: CommandProps) {
  if (dispatch) tr.setStoredMarks([]);
  return true;
}

/** 当前文本块所属的列表项类型（最近的 taskItem/listItem）。 */
function listItemType(editor: Editor): "taskItem" | "listItem" | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "taskItem") return "taskItem";
    if (name === "listItem") return "listItem";
  }
  return null;
}

/** 是否应把 Enter 交还 Tiptap 默认命令。 */
function shouldDeferToDefault(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if (EXEMPT_PARENTS.has($from.parent.type.name)) return true;
  if ($from.parent.content.size > 0) return false;

  // 空块：列表/引用/折叠内容需要默认命令负责“退出结构”。
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if (STRUCTURAL_ANCESTORS.has($from.node(depth).type.name)) return true;
  }
  return false;
}

/** 标题结尾按 Enter：显式插入正文段落，避免 splitBlock 在标题尾部无动作。 */
function splitHeading(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from } = selection;
  if ($from.parent.type.name !== "heading") return false;

  if ($from.parent.content.size === 0) {
    return editor.chain().setParagraph().command(clearStoredMarks).run();
  }
  if (!selection.empty || $from.parentOffset < $from.parent.content.size) return false;

  const insertPos = $from.after($from.depth);
  return editor
    .chain()
    .insertContentAt(insertPos, { type: "paragraph" })
    .setTextSelection(insertPos + 1)
    .command(clearStoredMarks)
    .scrollIntoView()
    .run();
}

/** 扩展：Enter 拆分新块后不继承颜色/高亮/粗斜体等行内 marks。 */
export const ClearMarksOnEnter = Extension.create({
  name: "clearMarksOnEnter",
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        if (shouldDeferToDefault(editor)) return false;
        if (splitHeading(editor)) return true;
        const listType = listItemType(editor);

        if (listType) {
          return editor.chain().splitListItem(listType).command(clearStoredMarks).run();
        }

        return editor.chain().splitBlock().command(clearStoredMarks).run();
      },
    };
  },
});
