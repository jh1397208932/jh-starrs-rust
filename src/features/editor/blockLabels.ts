const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  bulletList: "无序列表",
  orderedList: "有序列表",
  taskList: "任务列表",
  blockquote: "引用",
  codeBlock: "代码块",
  table: "表格",
  image: "图片",
  attachmentImage: "图片",
  attachmentBlock: "附件",
  details: "折叠块",
  horizontalRule: "分隔线",
};

export function blockTypeLabel(type: string | undefined): string {
  if (!type) return "内容";
  return BLOCK_TYPE_LABELS[type] ?? "内容";
}
