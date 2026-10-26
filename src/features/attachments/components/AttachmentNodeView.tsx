import { ChevronRight, Download, FileText, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadAttachment, getAttachmentByNode } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { pickAttachmentExportPath } from "@/api/fileDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useAttachmentPreview } from "@/features/editor/components/nodes/useAttachmentPreview";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import type { Attachment } from "@/types/attachment";
import type { NodeItem } from "@/types/notebook";
import { formatAttachmentBytes } from "../utils/format";

export interface AttachmentNodeViewProps {
  node: NodeItem;
  kbName: string | null;
  onOpenKb: () => void;
  onError: (message: string) => void;
}

/**
 * 附件节点标签页：按节点取 object_id，提供图片预览、元数据与下载。
 * 不展示 hash/pack/物理路径等存储实现细节。
 */
export function AttachmentNodeView({ node, kbName, onOpenKb, onError }: AttachmentNodeViewProps) {
  const { t } = useI18n();
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: node.title 用于重命名后刷新展示；reloadToken 仅作为重试触发器
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getAttachmentByNode(node.id)
      .then((value) => {
        if (!cancelled) setAttachment(value);
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

  const isImage = attachment?.mime.startsWith("image/") ?? false;
  const preview = useAttachmentPreview(isImage ? (attachment?.id ?? null) : null, attachment?.mime ?? "");

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
        <Button size="sm" variant="outline" disabled={downloading} onClick={() => void download()}>
          {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {t("下载")}
        </Button>
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

          {isImage ? (
            <div className="mt-6 overflow-hidden rounded-[14px] border border-border/70 bg-muted/30 p-3">
              {preview.loading ? (
                <div className="grid h-48 place-items-center text-[12.5px] text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> {t("正在加载图片…")}
                  </span>
                </div>
              ) : preview.url ? (
                <img
                  src={preview.url}
                  alt={attachment.name}
                  className="mx-auto max-h-[60vh] max-w-full rounded-[10px] object-contain"
                />
              ) : (
                <div className="grid h-40 place-items-center text-center text-[12.5px] text-muted-foreground">
                  <div>
                    <p>{preview.error ?? t("图片无法预览")}</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => void download()}>
                      {t("下载原文件")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 rounded-[14px] border border-border/70 bg-muted/30 px-5 py-8 text-center text-[12.5px] text-muted-foreground">
              {t("该类型暂不支持预览，可下载后查看。")}
            </div>
          )}

          <dl className="mt-6 rounded-[14px] border border-border/70">
            {[
              [t("名称"), attachment.name],
              [t("大小"), formatAttachmentBytes(attachment.size)],
              [t("类型"), attachment.mime || t("未知")],
              [t("创建时间"), formatTimestamp(attachment.createdAt)],
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
