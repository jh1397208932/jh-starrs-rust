/**
 * 从 canonical 树生成可独立查看的 SVG，并光栅化为 PNG。
 *
 * 导出前展开全部折叠分支（含自由主题子树），画布尺寸与 React Flow 使用同一套布局结果。
 * 关系线、外框、概要、主题样式与自动编号与画布保持一致。
 */

import type { MindmapContent, MindmapFile, MindmapLayout, MindmapTopic } from "@/types/mindmap";
import { layoutMindmap } from "./layout";
import { TOPIC_LINE_HEIGHT, TOPIC_PADDING_X, TOPIC_PADDING_Y, topicLines } from "./measure";

interface ExportTheme {
  background: string;
  card: string;
  foreground: string;
  muted: string;
  border: string;
  branches: string[];
}

/** 生成 SVG 字符串。 */
export function renderMindmapSvg(
  content: MindmapContent,
  title: string,
  images: Map<string, MindmapFile>,
  theme: ExportTheme,
): string {
  const expanded = expandAll(content);
  const layout = layoutMindmap(expanded);
  const padding = 64;
  const minX = Math.min(...layout.nodes.map((node) => node.x), 0) - padding;
  const minY = Math.min(...layout.nodes.map((node) => node.y), 0) - padding;
  const maxX = Math.max(...layout.nodes.map((node) => node.x + node.width), 0) + padding;
  const maxY = Math.max(...layout.nodes.map((node) => node.y + node.height), 0) + padding;
  const width = Math.max(320, maxX - minX);
  const height = Math.max(240, maxY - minY);
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`,
  );
  parts.push(
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${theme.background}"/>`,
  );
  parts.push(
    `<text x="${minX + 24}" y="${minY + 34}" fill="${theme.muted}" font-family="system-ui,PingFang SC,sans-serif" font-size="13">${escapeXml(title)}</text>`,
  );

  parts.push(...renderBoundaries(layout, theme));
  parts.push(...renderEdges(layout, byId, theme));
  parts.push(...renderRelationships(layout, theme));
  parts.push(...renderSummaries(layout, theme));

  for (const node of layout.nodes) {
    const appearance = topicAppearance(node, theme);
    const lines = topicLines(node.topic, node.depth === 0);
    if (!(node.topic.style?.borderShape === "underline")) {
      parts.push(
        `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${appearance.rx}" fill="${appearance.fill}" stroke="${appearance.color}" stroke-width="${appearance.strokeWidth}"/>`,
      );
    } else {
      parts.push(
        `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="0" fill="${appearance.fill}"/>`,
        `<line x1="${node.x}" y1="${node.y + node.height}" x2="${node.x + node.width}" y2="${node.y + node.height}" stroke="${appearance.color}" stroke-width="${appearance.strokeWidth + 0.8}"/>`,
      );
    }
    const textStartY = node.y + TOPIC_PADDING_Y + TOPIC_LINE_HEIGHT - 5;
    lines.forEach((line, index) => {
      parts.push(
        `<text x="${node.x + node.width / 2}" y="${textStartY + index * TOPIC_LINE_HEIGHT}" text-anchor="middle" fill="${theme.foreground}" font-family="system-ui,PingFang SC,sans-serif" font-size="14" font-weight="${node.depth === 0 ? 700 : 500}">${escapeXml(line)}</text>`,
      );
    });
    if (node.number) {
      parts.push(
        `<text x="${node.x + 6}" y="${node.y + node.height - 6}" fill="${appearance.color}" font-family="system-ui,PingFang SC,sans-serif" font-size="9" font-weight="600">${escapeXml(node.number)}</text>`,
      );
    }
    const image = node.topic.image ? images.get(node.topic.image.objectId) : undefined;
    if (image && node.topic.image) {
      const imageWidth = Math.min(node.width - TOPIC_PADDING_X * 2, node.topic.image.width);
      const imageHeight = Math.min(120, node.topic.image.height);
      parts.push(
        `<image href="${image.dataUrl}" x="${node.x + (node.width - imageWidth) / 2}" y="${node.y + TOPIC_PADDING_Y}" width="${imageWidth}" height="${imageHeight}"/>`,
      );
    }
    if (node.hiddenCount > 0) {
      parts.push(
        `<circle cx="${node.x + node.width}" cy="${node.y + node.height / 2}" r="9" fill="${theme.card}" stroke="${appearance.color}"/><text x="${node.x + node.width}" y="${node.y + node.height / 2 + 4}" text-anchor="middle" font-size="10" fill="${theme.foreground}">${node.hiddenCount}</text>`,
      );
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

/** 外框：成员包围盒 + 标签，位于连线与节点之下。 */
function renderBoundaries(layout: MindmapLayout, theme: ExportTheme): string[] {
  const parts: string[] = [];
  for (const boundary of layout.boundaries) {
    const color = boundary.color && boundary.color !== "auto" ? boundary.color : theme.border;
    parts.push(
      `<rect x="${boundary.x}" y="${boundary.y}" width="${boundary.width}" height="${boundary.height}" rx="12" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="6 4" opacity="0.85"/>`,
    );
    if (boundary.label) {
      parts.push(
        `<rect x="${boundary.x + boundary.width / 2 - 6 - boundary.label.length * 6.5}" y="${boundary.y - 10}" width="${boundary.label.length * 13 + 12}" height="20" rx="10" fill="${theme.card}" stroke="${color}"/>`,
        `<text x="${boundary.x + boundary.width / 2}" y="${boundary.y + 4}" text-anchor="middle" fill="${color}" font-family="system-ui,PingFang SC,sans-serif" font-size="11" font-weight="600">${escapeXml(boundary.label)}</text>`,
      );
    }
  }
  return parts;
}

/** 树连线：曲线/折线沿用画布的锚点语义。 */
function renderEdges(
  layout: MindmapLayout,
  byId: Map<string, MindmapLayout["nodes"][number]>,
  theme: ExportTheme,
): string[] {
  const parts: string[] = [];
  for (const edge of layout.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;
    const sx =
      edge.sourceHandle === "left"
        ? source.x
        : edge.sourceHandle === "down"
          ? source.x + source.width / 2
          : source.x + source.width;
    const sy = edge.sourceHandle === "down" ? source.y + source.height : source.y + source.height / 2;
    const tx =
      edge.targetHandle === "right"
        ? target.x + target.width
        : edge.targetHandle === "down"
          ? target.x + target.width / 2
          : target.x;
    const ty = edge.targetHandle === "down" ? target.y : target.y + target.height / 2;
    const mx = (sx + tx) / 2;
    const color = theme.branches[edge.branchIndex % theme.branches.length];
    parts.push(
      `<path d="M${sx} ${sy} C${mx} ${sy} ${mx} ${ty} ${tx} ${ty}" fill="none" stroke="${color}" stroke-width="${Math.max(1.5, 3 - edge.depth * 0.3)}" stroke-linecap="round"/>`,
    );
  }
  return parts;
}

/** 关系线：虚线 + 箭头 + 可选标签。 */
function renderRelationships(layout: MindmapLayout, theme: ExportTheme): string[] {
  const parts: string[] = [];
  for (const relation of layout.relationships) {
    const color = relation.color && relation.color !== "auto" ? relation.color : theme.muted;
    parts.push(
      `<path d="${relation.path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-dasharray="7 5" stroke-linecap="round"/>`,
    );
    const angle = Math.atan2(relation.toY - relation.fromY, relation.toX - relation.fromX);
    const tipX = relation.toX;
    const tipY = relation.toY;
    const left = `${tipX - 9 * Math.cos(angle - 0.42)} ${tipY - 9 * Math.sin(angle - 0.42)}`;
    const right = `${tipX - 9 * Math.cos(angle + 0.42)} ${tipY - 9 * Math.sin(angle + 0.42)}`;
    parts.push(`<polygon points="${tipX},${tipY} ${left} ${right}" fill="${color}"/>`);
    if (relation.label) {
      const labelX = (relation.fromX + relation.toX) / 2;
      const labelY = (relation.fromY + relation.toY) / 2 - 8;
      parts.push(
        `<rect x="${labelX - relation.label.length * 6 - 4}" y="${labelY - 12}" width="${relation.label.length * 12 + 8}" height="18" rx="9" fill="${theme.card}" stroke="${color}" opacity="0.95"/>`,
        `<text x="${labelX}" y="${labelY + 1}" text-anchor="middle" fill="${color}" font-family="system-ui,PingFang SC,sans-serif" font-size="11">${escapeXml(relation.label)}</text>`,
      );
    }
  }
  return parts;
}

/** 概要括号：沿成员外缘画一条带端点的折线。 */
function renderSummaries(layout: MindmapLayout, theme: ExportTheme): string[] {
  const parts: string[] = [];
  for (const summary of layout.summaries) {
    if (summary.direction === "down") {
      const y = summary.y + summary.height / 2;
      parts.push(
        `<path d="M${summary.x} ${y - 6} L${summary.x} ${y} L${summary.x + summary.width} ${y} L${summary.x + summary.width} ${y - 6}" fill="none" stroke="${theme.muted}" stroke-width="1.6" stroke-linecap="round"/>`,
      );
    } else {
      const x = summary.x + summary.width / 2;
      parts.push(
        `<path d="M${x - 6} ${summary.y} L${x} ${summary.y} L${x} ${summary.y + summary.height} L${x - 6} ${summary.y + summary.height}" fill="none" stroke="${theme.muted}" stroke-width="1.6" stroke-linecap="round"/>`,
      );
    }
  }
  return parts;
}

/** 主题外观：边框色/填充/形状/粗细，缺省回落到分支色与画布默认。 */
function topicAppearance(
  node: MindmapLayout["nodes"][number],
  theme: ExportTheme,
): { color: string; fill: string; strokeWidth: number; rx: number } {
  const style = node.topic.style ?? {};
  const branch = theme.branches[node.branchIndex % theme.branches.length];
  const color = style.borderColor && style.borderColor !== "auto" ? style.borderColor : branch;
  const fill =
    style.fill === "none"
      ? "none"
      : style.fill && style.fill !== "auto"
        ? `${style.fill}59`
        : node.depth === 0
          ? theme.card
          : theme.background;
  const strokeWidth =
    style.borderWidth === "thin" ? 1 : style.borderWidth === "bold" ? 2.6 : node.depth === 0 ? 2 : 1.4;
  const shape = style.borderShape ?? "rounded";
  const rx = shape === "pill" ? node.height / 2 : shape === "plain" ? 0 : node.depth === 0 ? 12 : 8;
  return { color, fill, strokeWidth, rx };
}

/** SVG 转 PNG Blob。 */
export async function svgToPngBlob(svg: string, scale = 2): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = parsed.documentElement;
  const width = Number(root.getAttribute("width") || 1200);
  const height = Number(root.getAttribute("height") || 800);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("导图 SVG 光栅化失败"));
    image.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器画布不可用");
  context.scale(scale, scale);
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG 导出失败"))), "image/png");
  });
}

function expandAll(content: MindmapContent): MindmapContent {
  return {
    ...content,
    sheet: { ...content.sheet, root: expandTopic(content.sheet.root) },
    freeTopics: (content.freeTopics ?? []).map((topic) => expandTopic(topic)),
  };
}

function expandTopic(topic: MindmapTopic): MindmapTopic {
  return {
    ...topic,
    collapsed: false,
    children: (topic.children ?? []).map(expandTopic),
  };
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
