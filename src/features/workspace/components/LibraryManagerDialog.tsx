import { CheckCircle2, Loader2, Package, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { pickLibraryFile } from "@/api/fileDialog";
import { deleteLibrary, importLibrary, listLibraries, setLibraryEnabled } from "@/api/library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { LIBRARY_CHANGED_EVENT, type Library } from "@/types/library";

export interface LibraryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onError: (message: string) => void;
}

/** 组件库管理：导入 .excalidrawlib、启用/禁用、删除导入库。 */
export function LibraryManagerDialog({ open, onOpenChange, onError }: LibraryManagerDialogProps) {
  const { t } = useI18n();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLibraries(await listLibraries());
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setPendingDelete(null);
    void reload();
  }, [open, reload]);

  const notifyChanged = () => {
    window.dispatchEvent(new CustomEvent(LIBRARY_CHANGED_EVENT));
  };

  const handleImport = async () => {
    const path = await pickLibraryFile();
    if (!path) return;
    setImporting(true);
    try {
      const library = await importLibrary({ path });
      await reload();
      notifyChanged();
      setStatus(t("已导入「{name}」，共 {count} 个组件", { name: library.name, count: library.itemCount }));
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  const handleToggle = async (library: Library, enabled: boolean) => {
    setBusyId(library.id);
    try {
      const updated = await setLibraryEnabled({ id: library.id, enabled });
      setLibraries((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      notifyChanged();
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (library: Library) => {
    if (pendingDelete !== library.id) {
      setPendingDelete(library.id);
      return;
    }
    setBusyId(library.id);
    try {
      const result = await deleteLibrary(library.id);
      setPendingDelete(null);
      await reload();
      notifyChanged();
      setStatus(t("已删除「{name}」及 {count} 个组件", { name: library.name, count: result.deletedItems }));
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[640px] max-w-[92vw] gap-4 p-5">
        <DialogHeader
          title={t("组件库")}
          description={t("启用后可在画板中使用。")}
          actions={
            <Button size="sm" onClick={() => void handleImport()} disabled={importing}>
              {importing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {t("导入组件库")}
            </Button>
          }
        />

        <div className="min-h-[220px] max-h-[52vh] overflow-y-auto rounded-[12px] border border-border/60">
          {loading ? (
            <div className="flex h-[220px] items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("正在读取组件库…")}
            </div>
          ) : libraries.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
              <Package className="size-7 text-muted-foreground/60" />
              <p className="text-[13px] font-medium text-foreground">{t("还没有组件库")}</p>
              <p className="text-[11.5px] text-muted-foreground">{t("导入后即可在画板中使用。")}</p>
            </div>
          ) : (
            <ul aria-label={t("组件库列表")}>
              {libraries.map((library) => (
                <li
                  key={library.id}
                  className="flex items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-secondary text-muted-foreground">
                    <Package className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium text-foreground">{library.name}</span>
                      <Badge variant={library.sourceType === "preset" ? "doc" : "board"}>
                        {library.sourceType === "preset" ? t("预设") : t("导入")}
                      </Badge>
                      {library.license ? <Badge variant="board">{library.license}</Badge> : null}
                    </div>
                    <p className="truncate text-[10.5px] text-muted-foreground">
                      {library.itemCount} {t("个组件")}
                      {library.author ? ` · ${library.author}` : ""}
                      {!library.enabled ? t(" · 已停用") : ""}
                    </p>
                  </div>
                  <Switch
                    checked={library.enabled}
                    disabled={busyId === library.id}
                    aria-label={
                      library.enabled
                        ? t("停用 {name}", { name: library.name })
                        : t("启用 {name}", { name: library.name })
                    }
                    onCheckedChange={(checked) => void handleToggle(library, checked)}
                  />
                  {library.sourceType === "import" ? (
                    <Button
                      variant={pendingDelete === library.id ? "destructive" : "ghost"}
                      size="icon-sm"
                      disabled={busyId === library.id}
                      aria-label={
                        pendingDelete === library.id
                          ? t("确认删除 {name}", { name: library.name })
                          : t("删除 {name}", { name: library.name })
                      }
                      onClick={() => void handleDelete(library)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : (
                    <span className="w-[26px]" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-[18px] items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="size-3 text-primary" />
            {t("预设素材来自 Excalidraw Libraries（MIT）。")}
          </span>
          {status ? (
            <span role="status" className="truncate text-accent-foreground">
              {status}
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
