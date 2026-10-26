import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAttachment,
  downloadAttachment,
  getAttachmentStats,
  listAttachments,
  restoreAttachment,
  runAttachmentMaintenance,
  uploadAttachment,
  verifyAttachment,
} from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { pickAttachmentExportPath, pickAttachmentFiles } from "@/api/fileDialog";
import { t } from "@/lib/i18n";
import type { Attachment, AttachmentStats } from "@/types/attachment";

/** 附件列表每页条数（服务端另多取 1 条判断是否还有下一页）。 */
const PAGE_SIZE = 50;

/**
 * 附件管理器数据与动作：加载、上传、导出、校验、删除。
 *
 * UI 只负责呈现；错误统一转成用户可读文案，不向外抛未处理异常。
 */
export function useAttachmentManager() {
  const [stats, setStats] = useState<AttachmentStats | null>(null);
  const [items, setItems] = useState<Attachment[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logicalPath, setLogicalPath] = useState("");
  /** 上传时声明的临时保留秒数；null 表示永久。 */
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const fetchData = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextItems] = await Promise.all([
        getAttachmentStats(),
        listAttachments({
          includeDeleted,
          search: search.trim() || null,
          limit: PAGE_SIZE + 1,
          offset: 0,
        }),
      ]);
      if (!mountedRef.current || request !== requestRef.current) return;
      setStats(nextStats);
      setItems(nextItems.slice(0, PAGE_SIZE));
      setHasMore(nextItems.length > PAGE_SIZE);
    } catch (caught) {
      if (mountedRef.current && request === requestRef.current) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (mountedRef.current && request === requestRef.current) {
        setLoading(false);
      }
    }
  }, [includeDeleted, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const loadMore = useCallback(() => {
    if (!hasMore || loading || loadingMore) return;
    const request = requestRef.current;
    setLoadingMore(true);
    void (async () => {
      try {
        const next = await listAttachments({
          includeDeleted,
          search: search.trim() || null,
          limit: PAGE_SIZE + 1,
          offset: items.length,
        });
        if (!mountedRef.current || request !== requestRef.current) return;
        setItems((current) => [...current, ...next.slice(0, PAGE_SIZE)]);
        setHasMore(next.length > PAGE_SIZE);
      } catch (caught) {
        if (mountedRef.current) setError(toErrorMessage(caught));
      } finally {
        if (mountedRef.current) setLoadingMore(false);
      }
    })();
  }, [hasMore, includeDeleted, items.length, loading, loadingMore, search]);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      if (mountedRef.current) setError(toErrorMessage(caught));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  const upload = useCallback(() => {
    if (busyRef.current) return;
    // 本地优先也要避免写满磁盘；阈值只拦截明显不足的剩余空间。
    if (stats?.diskFreeBytes !== null && stats?.diskFreeBytes !== undefined) {
      if (stats.diskFreeBytes < 256 * 1024 * 1024) {
        setError(t("磁盘剩余空间不足 256 MB，请先清理空间"));
        return;
      }
    }
    void (async () => {
      let paths: string[] = [];
      try {
        paths = await pickAttachmentFiles();
      } catch (caught) {
        setError(toErrorMessage(caught));
        return;
      }
      if (paths.length === 0) return;
      await run("upload", async () => {
        let uploaded = 0;
        const failures: string[] = [];
        for (const sourcePath of paths) {
          try {
            await uploadAttachment({
              sourcePath,
              logicalPath: logicalPath.trim(),
              ttlSeconds: ttlSeconds ?? undefined,
            });
            uploaded += 1;
          } catch (caught) {
            failures.push(toErrorMessage(caught));
          }
        }
        await fetchData();
        if (!mountedRef.current) return;
        if (failures.length > 0) {
          setError(
            t("已上传 {ok} 个，{failed} 个失败：{error}", {
              ok: uploaded,
              failed: failures.length,
              error: failures[0],
            }),
          );
        } else {
          setNotice(t("已上传 {count} 个附件", { count: uploaded }));
        }
      });
    })();
  }, [fetchData, logicalPath, run, stats, ttlSeconds]);

  const exportItem = useCallback(
    (item: Attachment) => {
      void (async () => {
        let target: string | null = null;
        try {
          target = await pickAttachmentExportPath(item.name);
        } catch (caught) {
          setError(toErrorMessage(caught));
          return;
        }
        if (!target) return;
        const destination = target;
        await run(`export:${item.id}`, async () => {
          await downloadAttachment({ id: item.id, destPath: destination, overwrite: true });
          if (mountedRef.current) setNotice(t("已导出「{name}」", { name: item.name }));
        });
      })();
    },
    [run],
  );

  const restoreItem = useCallback(
    (item: Attachment) => {
      void run(`restore:${item.id}`, async () => {
        await restoreAttachment(item.id);
        if (!mountedRef.current) return;
        await fetchData();
        if (mountedRef.current) setNotice(t("已恢复「{name}」", { name: item.name }));
      });
    },
    [fetchData, run],
  );

  const maintain = useCallback(() => {
    void run("maintenance", async () => {
      const result = await runAttachmentMaintenance();
      if (!mountedRef.current) return;
      await fetchData();
      if (mountedRef.current) {
        const reclaimed = Math.round(result.reclaimedBytes / 1024);
        const details = [
          result.orphanFiles > 0 ? t("隔离 {count} 个孤儿文件", { count: result.orphanFiles }) : "",
          result.docHashesRemoved > 0 ? t("移除 {count} 个块哈希", { count: result.docHashesRemoved }) : "",
          result.quarantineRemoved > 0
            ? t("清理 {count} 个隔离目录", { count: result.quarantineRemoved })
            : "",
        ]
          .filter(Boolean)
          .join("，");
        setNotice(
          t("已清理 {count} 项{details}，释放约 {kb} KB", {
            count: result.purged + result.expired + result.orphaned,
            details: details ? `，${details}` : "",
            kb: reclaimed,
          }),
        );
      }
    });
  }, [fetchData, run]);

  const verifyItem = useCallback(
    (item: Attachment) => {
      void run(`verify:${item.id}`, async () => {
        const result = await verifyAttachment(item.id);
        if (!mountedRef.current) return;
        if (result.valid) {
          setNotice(t("「{name}」校验通过", { name: item.name }));
        } else {
          setError(
            t("「{name}」校验失败：{message}", {
              name: item.name,
              message: result.message ?? t("校验未通过"),
            }),
          );
        }
      });
    },
    [run],
  );

  const requestDelete = useCallback(
    (item: Attachment) => {
      if (pendingDelete !== item.id) {
        setPendingDelete(item.id);
        return;
      }
      void run(`delete:${item.id}`, async () => {
        await deleteAttachment(item.id);
        if (!mountedRef.current) return;
        setPendingDelete(null);
        await fetchData();
        if (!mountedRef.current) return;
        setNotice(t("已删除「{name}」", { name: item.name }));
      });
    },
    [fetchData, pendingDelete, run],
  );

  return {
    stats,
    items,
    includeDeleted,
    setIncludeDeleted,
    search,
    setSearch,
    hasMore,
    loadingMore,
    loadMore,
    logicalPath,
    setLogicalPath,
    ttlSeconds,
    setTtlSeconds,
    loading,
    busy,
    error,
    setError,
    notice,
    pendingDelete,
    cancelDelete: () => setPendingDelete(null),
    refresh,
    upload,
    exportItem,
    verifyItem,
    restoreItem,
    maintain,
    requestDelete,
    disabled: busy !== null || loading,
  };
}
