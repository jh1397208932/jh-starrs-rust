import { ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type AttachmentPreview,
  downloadAttachment,
  getAttachmentByNode,
  getAttachmentPreview,
} from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { pickAttachmentExportPath } from "@/api/fileDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAttachmentPreview } from "@/features/editor/components/nodes/useAttachmentPreview";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/attachment";
import type { NodeItem } from "@/types/notebook";
import { formatAttachmentBytes } from "../utils/format";
import { AttachmentPreviewBlocks } from "./AttachmentPreviewBlocks";

export interface AttachmentNodeViewProps {
  node: NodeItem;
  kbName: string | null;
  onOpenKb: () => void;
  onError: (message: string) => void;
}

/** 预览分派：图片走字节链路，txt 显示原文，md/docx 走块渲染，其余交给兜底文案。 */
type PreviewKind = "image" | "text" | "document" | "none";

const DOCUMENT_EXTENSIONS = new Set(["md", "markdown", "docx", "docm", "dotx", "dotm", "doc"]);

/**
 * 文字/Word 预览结果的小缓存（按 节点+更新时间 作键）。
 *
 * Word 预览要在 Rust 侧解析文档再组装块，每次重开附件页都重跑一遍很浪费；
 * 键里带 updatedAt，附件被替换后自然失效。只保留最近 8 份，避免长会话吃内存。
 */
const DOC_PREVIEW_CACHE_MAX = 8;
const docPreviewCache = new Map<string, AttachmentPreview>();

function docPreviewKey(nodeId: string, updatedAt: number): string {
  return `${nodeId}:${updatedAt}`;
}

function cacheDocPreview(key: string, value: AttachmentPreview): void {
  docPreviewCache.delete(key);
  docPreviewCache.set(key, value);
  while (docPreviewCache.size > DOC_PREVIEW_CACHE_MAX) {
    const oldest = docPreviewCache.keys().next().value;
    if (oldest === undefined) break;
    docPreviewCache.delete(oldest);
  }
}

function classifyPreview(name: string, mime: string): PreviewKind {
  if (mime.startsWith("image/")) return "image";
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (extension === "txt" || mime === "text/plain") return "text";
  if (DOCUMENT_EXTENSIONS.has(extension) || mime === "text/markdown") return "document";
  return "none";
}

/**
 * 附件节点标签页：图片与常用文档在应用内直接看，其它类型只提供下载。
 * 不展示 hash/pack/物理路径等存储实现细节，也不提供完整性校验这类程序内部入口。
 */
export function AttachmentNodeView({ node, kbName, onOpenKb, onError }: AttachmentNodeViewProps) {
  const { t } = useI18n();
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [docPreview, setDocPreview] = useState<AttachmentPreview | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  // 图片自然尺寸：太小（<24px）的图放大显示，否则 1×1 之类看起来就是一块空的。
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [imageBroken, setImageBroken] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: node.title 用于重命名后刷新展示；reloadToken 仅作为重试触发器
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getAttachmentByNode(node.id)
      .then((value) => {
        if (cancelled) return;
        setAttachment(value);
        // 换附件时清掉上一张图的尺寸/失败标记，避免沿用旧标注。
        setImageSize(null);
        setImageBroken(false);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(toErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node.id, node.title, reloadToken]);

  const previewKind = attachment ? classifyPreview(attachment.name, attachment.mime) : "none";
  const preview = useAttachmentPreview(
    previewKind === "image" ? (attachment?.id ?? null) : null,
    attachment?.mime ?? "",
  );

  // 文字类预览单独取内容：文本与块两种形态，读取失败要给出可读原因而不是空白。
  useEffect(() => {
    if (!attachment || (previewKind !== "text" && previewKind !== "document")) return;
    const cacheKey = docPreviewKey(node.id, attachment.updatedAt);
    const cached = docPreviewCache.get(cacheKey);
    if (cached) {
      setDocLoading(false);
      setDocError(null);
      setDocPreview(cached);
      return;
    }
    let cancelled = false;
    setDocLoading(true);
    setDocError(null);
    setDocPreview(null);
    void getAttachmentPreview(node.id)
      .then((value) => {
        cacheDocPreview(cacheKey, value);
        if (!cancelled) setDocPreview(value);
      })
      .catch((error) => {
        if (!cancelled) setDocError(toErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, node.id, previewKind]);

  const download = async () => {
    if (!attachment || downloading) return;
    setDownloading(true);
    setNotice(null);
    try {
      const target = await pickAttachmentExportPath(attachment.name);
      if (!target) return;
      await downloadAttachment({ id: attachment.id, destPath: target, overwrite: true });
      setNotice(t("已下载"));
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> {t("正在加载附件…")}
        </span>
      </div>
    );
  }

  if (loadError || !attachment) {
    return (
      <EmptyState glyph="!" title={t("附件不可用")} description={loadError ?? t("附件可能已被删除")}>
        <Button variant="secondary" size="sm" onClick={() => setReloadToken((value) => value + 1)}>
          {t("重新加载")}
        </Button>
      </EmptyState>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-4">
        <div className="flex min-w-0 items-center gap-1 text-[12.5px]">
          {kbName ? (
            <>
              <button
                type="button"
                onClick={onOpenKb}
                className="truncate rounded-[6px] px-1 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {kbName}
              </button>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
            </>
          ) : null}
          <span className="truncate font-medium text-foreground">{node.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={downloading} onClick={() => void download()}>
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {t("下载")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-[760px]">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-[12px] bg-secondary text-muted-foreground">
              <FileText className="size-5" />
            </span>
            <div className="min-w-0">
              <h1
                aria-label={t("附件详情 {name}", { name: attachment.name })}
                className="truncate text-[22px] font-semibold text-foreground"
              >
                {attachment.name}
              </h1>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {formatAttachmentBytes(attachment.size)} · {attachment.mime || t("未知类型")}
              </p>
            </div>
          </div>

          {previewKind === "image" ? (
            <div className="mt-6 overflow-hidden rounded-[14px] border border-border/70 bg-muted/30 p-3">
              {preview.loading ? (
                <div className="grid h-48 place-items-center text-[12.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {t("正在加载图片…")}
                  </span>
                </div>
              ) : preview.url && !imageBroken ? (
                <>
                  {/* 透明底用棋盘格衬出来，小图放大显示，避免「一块空白」看不出到底有没有图。 */}
                  <div className="rounded-[10px] bg-[repeating-conic-gradient(#0000000d_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-2">
                    <img
                      src={preview.url}
                      alt={attachment.name}
                      onLoad={(event) => {
                        const image = event.currentTarget;
                        setImageSize({
                          width: image.naturalWidth,
                          height: image.naturalHeight,
                        });
                        setImageBroken(false);
                      }}
                      onError={() => setImageBroken(true)}
                      className="mx-auto max-h-[60vh] max-w-full rounded-[6px] object-contain"
                      style={
                        imageSize && imageSize.width < 24 && imageSize.height < 24
                          ? {
                              width: Math.max(96, imageSize.width * 8),
                              height: Math.max(96, imageSize.height * 8),
                              imageRendering: "pixelated",
                            }
                          : undefined
                      }
                    />
                  </div>
                  {imageSize && (
                    <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                      {/* 拼成一个字符串：分三个文本节点会被 AX 拆开，读不到整串尺寸。 */}
                      {`${imageSize.width} × ${imageSize.height}${
                        imageSize.width < 24 && imageSize.height < 24 ? ` · ${t("小图已放大显示")}` : ""
                      }`}
                    </p>
                  )}
                </>
              ) : (
                <PreviewError
                  message={preview.error ?? t("图片无法显示，可下载后查看")}
                  onDownload={() => void download()}
                />
              )}
            </div>
          ) : previewKind === "text" || previewKind === "document" ? (
            <div className="mt-6 overflow-hidden rounded-[14px] border border-border/70 bg-muted/30">
              {docLoading ? (
                <div className="grid h-40 place-items-center text-[12.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {t("正在加载预览…")}
                  </span>
                </div>
              ) : docError ? (
                <PreviewError message={docError} onDownload={() => void download()} />
              ) : docPreview?.kind === "text" ? (
                <>
                  <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground">
                    {docPreview.text}
                  </pre>
                  {docPreview.truncated && <PreviewFooter text={t("仅显示前 512 KB，完整内容请下载查看")} />}
                </>
              ) : docPreview?.kind === "blocks" ? (
                <>
                  <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
                    <AttachmentPreviewBlocks blocks={docPreview.blocks} />
                  </div>
                  {docPreview.truncated && <PreviewFooter text={t("内容较长，仅显示前 400 段")} />}
                </>
              ) : (
                <FallbackNotice
                  text={t("该类型暂不支持预览，可下载后查看。")}
                  onDownload={() => void download()}
                />
              )}
            </div>
          ) : (
            <FallbackNotice
              text={t("该类型暂不支持预览，可下载后查看。")}
              onDownload={() => void download()}
            />
          )}

          <dl className="mt-6 rounded-[14px] border border-border/70">
            {[
              [t("名称"), attachment.name],
              [t("大小"), formatAttachmentBytes(attachment.size)],
              [t("类型"), attachment.mime || t("未知")],
              [t("更新时间"), formatTimestamp(attachment.updatedAt)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 border-b border-border/50 px-4 py-2.5 last:border-b-0"
              >
                <dt className="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
                <dd className="min-w-0 truncate text-right text-[13px] text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          {notice && (
            <p role="status" className="mt-4 text-[12px] text-primary">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FallbackNotice({ text, onDownload }: { text: string; onDownload: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "mt-6 rounded-[14px] border border-border/70 bg-muted/30 px-5 py-8 text-center text-[12.5px] text-muted-foreground",
      )}
    >
      <p>{text}</p>
      <Button className="mt-3" size="sm" variant="secondary" onClick={onDownload}>
        {t("下载原文件")}
      </Button>
    </div>
  );
}

function PreviewError({ message, onDownload }: { message: string; onDownload: () => void }) {
  const { t } = useI18n();
  return (
    <div className="grid h-40 place-items-center text-center text-[12.5px] text-muted-foreground">
      <div>
        <p>{message}</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={onDownload}>
          {t("下载原文件")}
        </Button>
      </div>
    </div>
  );
}

function PreviewFooter({ text }: { text: string }) {
  return <p className="border-t border-border/50 px-4 py-2 text-[11.5px] text-muted-foreground">{text}</p>;
}
