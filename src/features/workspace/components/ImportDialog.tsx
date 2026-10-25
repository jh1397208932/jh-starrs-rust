import { AlertCircle, CheckCircle2, FileUp, FolderOpen, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { pickDirectory } from "@/api/directory";
import { pickImportFiles } from "@/api/fileDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ImportDocumentsParams, ImportMode, ImportResult } from "@/types/exchange";
import type { NodeItem } from "@/types/notebook";

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
  const [parentId, setParentId] = useState<string>(defaultParentId ?? ROOT_VALUE);
  const [mode, setMode] = useState<ImportMode>("files");
  const [paths, setPaths] = useState<string[]>([]);
  const [preserveHierarchy, setPreserveHierarchy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setParentId(defaultParentId ?? ROOT_VALUE);
    setPaths([]);
    setMode("files");
    setPreserveHierarchy(true);
    setResult(null);
    setError(null);
  }, [open, defaultParentId]);

  const folders = useMemo(
    () =>
      nodes
        .filter((node) => node.kind === "folder")
        .sort((left, right) => left.path.localeCompare(right.path, "zh-CN")),
    [nodes],
  );

  const chooseFiles = async () => {
    const selected = await pickImportFiles();
    if (selected.length === 0) return;
    setMode("files");
    setPaths(selected);
    setPreserveHierarchy(false);
    setResult(null);
  };

  const chooseDirectory = async () => {
    const selected = await pickDirectory({ title: "选择要导入的文件夹" });
    if (!selected) return;
    setMode("directory");
    setPaths([selected]);
    setPreserveHierarchy(true);
    setResult(null);
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
      setError(caught instanceof Error && caught.message.trim() ? caught.message : "导入失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel =
    paths.length === 0
      ? "尚未选择"
      : mode === "directory"
        ? paths[0]
        : `${paths.length} 个文件：${paths
            .slice(0, 3)
            .map((path) => path.split(/[\\/]/).pop())
            .join("、")}${paths.length > 3 ? "…" : ""}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="w-[600px] p-5" aria-describedby={undefined}>
        <DialogTitle>导入</DialogTitle>
        <DialogDescription className="mt-1 text-[12.5px] text-muted-foreground">
          支持 Markdown、Word 与 Excalidraw。
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">导入到</span>
            <Select value={parentId} onValueChange={setParentId} disabled={busy}>
              <SelectTrigger aria-label="导入目标文件夹">
                <SelectValue placeholder="知识库根目录" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>知识库根目录</SelectItem>
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
                "flex cursor-default items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                mode === "files" && paths.length > 0 && "border-primary/40 bg-accent",
              )}
            >
              <FileUp className="size-4 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">选择文件</span>
                <span className="block text-[11.5px] text-muted-foreground">可多选</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void chooseDirectory()}
              disabled={busy}
              className={cn(
                "flex cursor-default items-center gap-2.5 rounded-md border border-border bg-card p-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60",
                mode === "directory" && paths.length > 0 && "border-primary/40 bg-accent",
              )}
            >
              <FolderOpen className="size-4 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">选择文件夹</span>
                <span className="block text-[11.5px] text-muted-foreground">含子文件夹</span>
              </span>
            </button>
          </div>

          <div className="rounded-md border border-border/70 bg-secondary/45 px-3 py-2.5">
            <p className="text-[11.5px] text-muted-foreground">来源</p>
            <p className="mt-0.5 min-w-0 truncate text-[12.5px] text-foreground" title={sourceLabel}>
              {sourceLabel}
            </p>
            {mode === "directory" && paths.length > 0 && (
              <label className="mt-2 flex cursor-default items-center gap-2 text-[12px] text-foreground">
                <input
                  type="checkbox"
                  checked={preserveHierarchy}
                  disabled={busy}
                  onChange={(event) => setPreserveHierarchy(event.target.checked)}
                  className="size-3.5 accent-[var(--primary)]"
                />
                保留文件夹结构
              </label>
            )}
          </div>

          {result && (
            <div
              className={cn(
                "rounded-md border px-3 py-2.5 text-[12.5px]",
                result.failed > 0
                  ? "border-amber-500/40 bg-amber-500/5 text-foreground"
                  : "border-primary/35 bg-accent text-accent-foreground",
              )}
            >
              <p className="flex items-center gap-1.5 font-medium">
                {result.failed > 0 ? (
                  <AlertCircle className="size-4 text-amber-600" />
                ) : (
                  <CheckCircle2 className="size-4 text-primary" />
                )}
                已导入 {result.imported} 项，失败 {result.failed} 项
              </p>
              {result.files
                .filter((file) => !file.ok)
                .slice(0, 4)
                .map((file) => (
                  <p key={file.sourcePath} className="mt-1 truncate text-[11.5px] text-muted-foreground">
                    {file.sourcePath.split(/[\\/]/).pop()}：{file.message ?? "导入失败"}
                  </p>
                ))}
              {result.files.some((file) => file.warnings.length > 0) && (
                <p className="mt-1 text-[11.5px] text-muted-foreground">部分内容有格式警告。</p>
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
            {result ? "完成" : "取消"}
          </Button>
          <Button
            size="sm"
            disabled={busy || paths.length === 0 || !knowledgeBaseId}
            onClick={() => void run()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {busy ? "正在导入…" : "导入"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
