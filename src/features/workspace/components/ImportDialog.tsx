import { AlertCircle, CheckCircle2, FileUp, FolderOpen, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { pickDirectory } from "@/api/directory";
import { scanImportFolder } from "@/api/exchange";
import { pickImportFiles } from "@/api/fileDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ImportDocumentsParams, ImportMode, ImportResult, ImportScanResult } from "@/types/exchange";
import type { NodeItem } from "@/types/notebook";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标知识库 id */
  knowledgeBaseId: string;
  /** 当前知识库全部节点（用于目标文件夹选择） */
  nodes: NodeItem[];
  /** 默认目标父级；null 表示知识库根目录 */
  defaultParentId: string | null;
  onImport: (params: ImportDocumentsParams) => Promise<ImportResult>;
  /** 导入完成后回调（父级刷新树、提示等） */
  onImported?: (result: ImportResult) => void;
}

const ROOT_VALUE = "__root__";

/** 导入弹窗：目标文件夹 + 文件/目录来源 + 批量结果。 */
export function ImportDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
  nodes,
  defaultParentId,
  onImport,
  onImported,
}: ImportDialogProps) {
  const { t } = useI18n();
  const [parentId, setParentId] = useState<string>(defaultParentId ?? ROOT_VALUE);
  const [mode, setMode] = useState<ImportMode>("files");
  const [paths, setPaths] = useState<string[]>([]);
  const [preserveHierarchy, setPreserveHierarchy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ImportScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirmSkipOpen, setConfirmSkipOpen] = useState(false);
  const scanSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    scanSeqRef.current += 1;
    setParentId(defaultParentId ?? ROOT_VALUE);
    setPaths([]);
    setMode("files");
    setPreserveHierarchy(true);
    setResult(null);
    setError(null);
    setScan(null);
    setScanning(false);
    setScanError(null);
    setConfirmSkipOpen(false);
  }, [open, defaultParentId]);

  const folders = useMemo(
    () =>
      nodes
        .filter((node) => node.kind === "folder")
        .sort((left, right) => left.path.localeCompare(right.path, "zh-CN")),
    [nodes],
  );

  const resetScan = () => {
    scanSeqRef.current += 1;
    setScan(null);
    setScanning(false);
    setScanError(null);
  };

  const runScan = async (folder: string) => {
    const sequence = ++scanSeqRef.current;
    setScanning(true);
    setScan(null);
    setScanError(null);
    try {
      const summary = await scanImportFolder(folder);
      if (sequence !== scanSeqRef.current) return;
      setScan(summary);
    } catch (caught) {
      if (sequence !== scanSeqRef.current) return;
      setScanError(toErrorMessage(caught));
    } finally {
      if (sequence === scanSeqRef.current) setScanning(false);
    }
  };

  const chooseFiles = async () => {
    const selected = await pickImportFiles();
    if (selected.length === 0) return;
    resetScan();
    setMode("files");
    setPaths(selected);
    setPreserveHierarchy(false);
    setResult(null);
  };

  const chooseDirectory = async () => {
    const selected = await pickDirectory({ title: t("选择要导入的文件夹") });
    if (!selected) return;
    setMode("directory");
    setPaths([selected]);
    setPreserveHierarchy(true);
    setResult(null);
    await runScan(selected);
  };

  const run = async () => {
    if (busy || paths.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const imported = await onImport({
        knowledgeBaseId,
        parentId: parentId === ROOT_VALUE ? null : parentId,
        paths,
        mode,
        preserveHierarchy: mode === "directory" && preserveHierarchy,
      });
      setResult(imported);
      onImported?.(imported);
    } catch (caught) {
      setError(caught instanceof Error && caught.message.trim() ? caught.message : t("导入失败，请重试"));
    } finally {
      setBusy(false);
    }
  };

  /** 目录模式先扫描；有跳过项时必须再确认一次才真正导入。 */
  const requestRun = () => {
    if (busy || scanning || paths.length === 0) return;
    if (mode === "directory" && scan && scan.unsupportedCount > 0) {
      setConfirmSkipOpen(true);
      return;
    }
    void run();
  };

  const mixedEmpty =
    mode === "directory" && scan !== null && scan.documents + scan.boards + scan.mindmaps === 0;
  const canRun =
    !busy &&
    !scanning &&
    paths.length > 0 &&
    Boolean(knowledgeBaseId) &&
    (mode !== "directory" || (scan !== null && !scanError && !mixedEmpty));

  const sourceLabel =
    paths.length === 0
      ? t("尚未选择")
      : mode === "directory"
        ? paths[0]
        : t("{count} 个文件：{names}{more}", {
            count: paths.length,
            names: paths
              .slice(0, 3)
              .map((path) => path.split(/[\\/]/).pop())
              .join(", "),
            more: paths.length > 3 ? "…" : "",
          });

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className="w-[600px] p-5" aria-describedby={undefined}>
          <DialogTitle>{t("导入")}</DialogTitle>
          <DialogDescription className="mt-1 text-[12.5px] text-muted-foreground">
            {t("选择文件或文件夹，导入为文档、画板或思维导图。")}
          </DialogDescription>

          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-foreground">{t("导入到")}</span>
              <Select value={parentId} onValueChange={setParentId} disabled={busy}>
                <SelectTrigger aria-label={t("导入目标文件夹")}>
                  <SelectValue
                    placeholder={t("知识库根目录")}
                    label={
                      parentId === ROOT_VALUE
                        ? t("知识库根目录")
                        : (folders.find((folder) => folder.id === parentId)?.path ?? t("知识库根目录"))
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_VALUE}>{t("知识库根目录")}</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void chooseFiles()}
                disabled={busy}
                className={cn(
                  "flex cursor-default items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60",
                  mode === "files" && paths.length > 0 && "border-primary/40 bg-accent",
                )}
              >
                <FileUp className="size-4 text-muted-foreground" />
                <span className="min-w-0 text-[13.5px] font-medium">{t("选择文件")}</span>
              </button>
              <button
                type="button"
                onClick={() => void chooseDirectory()}
                disabled={busy}
                className={cn(
                  "flex cursor-default items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60",
                  mode === "directory" && paths.length > 0 && "border-primary/40 bg-accent",
                )}
              >
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="min-w-0 text-[13.5px] font-medium">{t("选择文件夹")}</span>
              </button>
            </div>

            {paths.length > 0 && (
              <div className="rounded-md border border-border/70 bg-secondary/45 px-3 py-2.5">
                <p className="min-w-0 truncate text-[12.5px] text-foreground" title={sourceLabel}>
                  {mode === "directory"
                    ? t("已选择：{name}", { name: paths[0].split(/[\\/]/).pop() ?? "" })
                    : sourceLabel}
                </p>
                {mode === "directory" && (
                  <label className="mt-2 flex cursor-default items-center gap-2 text-[12px] text-foreground">
                    <input
                      type="checkbox"
                      checked={preserveHierarchy}
                      disabled={busy}
                      onChange={(event) => setPreserveHierarchy(event.target.checked)}
                      className="size-3.5 accent-[var(--primary)]"
                    />
                    {t("保留文件夹结构")}
                  </label>
                )}
              </div>
            )}

            {mode === "directory" && paths.length > 0 && (
              <div className="rounded-md border border-border/70 bg-card/60 px-3 py-2.5 text-[12px]">
                {scanning ? (
                  <p className="inline-flex items-center gap-2 text-muted-foreground" aria-live="polite">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("正在准备…")}
                  </p>
                ) : scanError ? (
                  <div>
                    <p role="alert" className="text-destructive">
                      {t("无法读取这个文件夹，请重试。")}
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-[11.5px] text-accent-foreground underline underline-offset-2"
                      onClick={() => void runScan(paths[0])}
                    >
                      {t("重试")}
                    </button>
                  </div>
                ) : scan ? (
                  <div>
                    <p className="text-foreground">
                      {t("找到 {count} 个文件，将导入 {importable} 个。", {
                        count: scan.totalFiles,
                        importable: scan.documents + scan.boards + scan.mindmaps,
                      })}
                    </p>
                    {scan.attachments > 0 && (
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {t("其中 {count} 个附件会一并保存。", { count: scan.attachments })}
                      </p>
                    )}
                    {scan.documents + scan.boards + scan.mindmaps === 0 && (
                      <p className="mt-1 text-destructive">{t("这个文件夹里没有可导入的内容。")}</p>
                    )}
                    {scan.unsupportedCount > 0 ? (
                      <div className="mt-1.5">
                        <p className="text-[11.5px] text-[var(--logo-c)]">
                          {t("跳过 {count} 个无法识别的文件", { count: scan.unsupportedCount })}
                        </p>
                        <ul className="mt-1 max-h-[92px] overflow-y-auto rounded-[6px] bg-secondary/45 px-2 py-1">
                          {scan.unsupported.slice(0, 8).map((item) => (
                            <li
                              key={item.path}
                              className="truncate font-mono text-[10.5px] text-muted-foreground"
                              title={item.path}
                            >
                              {item.path}
                            </li>
                          ))}
                          {scan.unsupportedCount > 8 && (
                            <li className="text-[10.5px] text-muted-foreground">
                              {t("等 {count} 个文件", { count: scan.unsupportedCount })}
                            </li>
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            {result && (
              <div
                className={cn(
                  "rounded-md border px-3 py-2.5 text-[12.5px]",
                  result.failed > 0
                    ? "text-foreground"
                    : "border-primary/35 bg-accent text-accent-foreground",
                )}
                style={
                  result.failed > 0
                    ? {
                        borderColor: "color-mix(in srgb, var(--logo-c) 42%, transparent)",
                        background: "color-mix(in srgb, var(--logo-c) 6%, transparent)",
                      }
                    : undefined
                }
              >
                <p className="flex items-center gap-1.5 font-medium">
                  {result.failed > 0 ? (
                    <AlertCircle className="size-4 text-[var(--logo-c)]" />
                  ) : (
                    <CheckCircle2 className="size-4 text-primary" />
                  )}
                  {t("已导入 {count} 项，失败 {failed} 项", {
                    count: result.imported,
                    failed: result.failed,
                  })}
                </p>
                {result.files
                  .filter((file) => !file.ok)
                  .slice(0, 4)
                  .map((file) => (
                    <p key={file.sourcePath} className="mt-1 truncate text-[11.5px] text-muted-foreground">
                      {file.sourcePath.split(/[\\/]/).pop()}：{file.message ?? t("导入失败")}
                    </p>
                  ))}
                {result.files.some((file) => file.warnings.length > 0) && (
                  <div className="mt-1 space-y-0.5">
                    {Array.from(
                      new Set(
                        result.files.flatMap((file) =>
                          file.warnings.map(
                            (warning) => `${file.sourcePath.split(/[\\/]/).pop()}：${warning}`,
                          ),
                        ),
                      ),
                    )
                      .slice(0, 3)
                      .map((line) => (
                        <p key={line} className="truncate text-[11.5px] text-muted-foreground" title={line}>
                          {line}
                        </p>
                      ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              {result ? t("完成") : t("取消")}
            </Button>
            <Button size="sm" disabled={!canRun} onClick={requestRun}>
              {busy || scanning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {busy ? t("正在导入…") : scanning ? t("正在准备…") : t("导入")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSkipOpen}
        onOpenChange={setConfirmSkipOpen}
        title={t("跳过不支持的文件？")}
        description={t("有 {count} 个文件无法识别，将被跳过。", { count: scan?.unsupportedCount ?? 0 })}
        confirmLabel={t("仍要导入")}
        onConfirm={() => run()}
      />
    </>
  );
}
