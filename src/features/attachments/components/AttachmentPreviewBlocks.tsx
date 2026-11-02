import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 只读块渲染：把 Markdown / Word 解析出的编辑器块 JSON 渲染成排版内容。
 *
 * 与文档编辑器共用同一套块模型，但这里只读、不挂编辑交互，也不渲染原始 HTML：
 * 未知节点降级成纯文本，避免预览把不可信内容当结构执行。
 */
export function AttachmentPreviewBlocks({ blocks }: { blocks: unknown[] }) {
  return <div className="space-y-2.5">{blocks.map(renderBlock)}</div>;
}

interface BlockNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: unknown[];
  text?: string;
  marks?: { type?: string }[];
}

function asNode(value: unknown): BlockNode | null {
  if (!value || typeof value !== "object") return null;
  return value as BlockNode;
}

function renderBlock(value: unknown, index: number): ReactNode {
  const node = asNode(value);
  if (!node) return null;
  const key = `${node.type ?? "block"}-${index}`;
  const children = node.content ?? [];

  switch (node.type) {
    case "heading": {
      const level = Number(node.attrs?.level ?? 2);
      const cls =
        level <= 1
          ? "text-[19px] font-semibold"
          : level === 2
            ? "text-[16.5px] font-semibold"
            : "text-[14.5px] font-semibold";
      return (
        <p key={key} className={cn("mt-3 text-foreground", cls)}>
          {renderInline(children)}
        </p>
      );
    }
    case "paragraph":
      return (
        <p key={key} className="text-[13.5px] leading-relaxed text-foreground">
          {renderInline(children)}
        </p>
      );
    case "bulletList":
    case "taskList":
      return renderList(key, children, "ul");
    case "orderedList":
      return renderList(key, children, "ol");
    case "codeBlock":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-[8px] border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground"
        >
          <code>{plainText(children)}</code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-primary/40 pl-3 text-[13.5px] leading-relaxed text-muted-foreground"
        >
          {children.map(renderBlock)}
        </blockquote>
      );
    case "horizontalRule":
      return <hr key={key} className="my-3 border-border/60" />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>{children.map(renderBlock)}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{children.map(renderBlock)}</tr>;
    case "tableHeader":
      return (
        <th key={key} className="border border-border/60 bg-muted/40 px-2 py-1 text-left font-medium">
          {children.map(renderBlock)}
        </th>
      );
    case "tableCell":
      return (
        <td key={key} className="border border-border/60 px-2 py-1">
          {children.map(renderBlock)}
        </td>
      );
    case "image":
    case "attachmentImage":
      return (
        <p key={key} className="text-[12px] text-muted-foreground">
          〔图片〕{String(node.attrs?.alt ?? "")}
        </p>
      );
    case "listItem":
    case "taskItem":
      return <span key={key}>{renderListItem(node)}</span>;
    default:
      if (node.text) {
        return (
          <p key={key} className="text-[13.5px] leading-relaxed text-foreground">
            {node.text}
          </p>
        );
      }
      if (children.length > 0) {
        return <div key={key}>{children.map(renderBlock)}</div>;
      }
      return null;
  }
}

/** 列表项 key 取内容而非下标：内容相同的项按出现次数区分，避免增删一项时整列重挂载。 */
function renderList(key: string, children: unknown[], kind: "ul" | "ol"): ReactNode {
  const seen = new Map<string, number>();
  const items = children.map((child) => {
    const base = plainText([child]).slice(0, 40) || "item";
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { id: `${key}-${base}-${count}`, node: child };
  });
  const className =
    kind === "ul"
      ? "list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed"
      : "list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed";
  if (kind === "ol") {
    return (
      <ol key={key} className={className}>
        {items.map((item) => (
          <li key={item.id}>{renderListItem(item.node)}</li>
        ))}
      </ol>
    );
  }
  return (
    <ul key={key} className={className}>
      {items.map((item) => (
        <li key={item.id}>{renderListItem(item.node)}</li>
      ))}
    </ul>
  );
}

function renderListItem(value: unknown): ReactNode {
  const node = asNode(value);
  if (!node) return null;
  const children = node.content ?? [];
  return <>{children.map((child, order) => renderBlock(child, order))}</>;
}

function renderInline(nodes: unknown[]): ReactNode {
  return nodes.map((value, index) => {
    const node = asNode(value);
    if (!node) return null;
    const key = `inline-${index}`;
    if (node.type === "hardBreak") return <br key={key} />;
    if (node.type === "text" || (!node.type && node.text)) {
      return <MarkedText key={key} text={node.text ?? ""} marks={node.marks ?? []} />;
    }
    if (node.type === "image" || node.type === "attachmentImage") {
      return (
        <span key={key} className="text-muted-foreground">
          〔图片〕
        </span>
      );
    }
    if (node.content && node.content.length > 0) {
      return <span key={key}>{renderInline(node.content)}</span>;
    }
    return node.text ? <span key={key}>{node.text}</span> : null;
  });
}

/** 行内样式只支持加粗/斜体/删除线/代码，链接按纯文本呈现，不产生可点击外链。 */
function MarkedText({ text, marks }: { text: string; marks: { type?: string }[] }) {
  const kinds = new Set(marks.map((mark) => mark.type));
  let node: ReactNode = text;
  if (kinds.has("code")) {
    node = <code className="rounded-[4px] bg-muted/60 px-1 py-[1px] font-mono text-[12px]">{node}</code>;
  }
  if (kinds.has("bold")) node = <strong>{node}</strong>;
  if (kinds.has("italic")) node = <em>{node}</em>;
  if (kinds.has("strike")) node = <s>{node}</s>;
  return <>{node}</>;
}

/** 代码块等内容需要纯文本：把行内节点拼成字符串。 */
function plainText(nodes: unknown[]): string {
  return nodes
    .map((value) => {
      const node = asNode(value);
      if (!node) return "";
      if (node.text) return node.text;
      return node.content ? plainText(node.content) : "";
    })
    .join("");
}
