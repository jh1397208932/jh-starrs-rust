import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAttachment,
  downloadAttachment,
  getAttachmentStats,
  listAttachments,
  uploadAttachment,
  verifyAttachment,
} from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { pickAttachmentExportPath, pickAttachmentFiles } from "@/api/fileDialog";
import type { Attachment, AttachmentStats } from "@/types/attachment";

/**
 * 附件管理器数据与动作：加载、上传、导出、校验、删除。
 *
 * UI 只负责呈现；错误统一转成用户可读文案，不向外抛未处理异常。
 */
export function useAttachmentManager() {
  const [stats, setStats] = useState<AttachmentStats | null>(null);
  const [items, setItems] = useState<Attachment[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [logicalPath, setLogicalPath] = useState("");
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
        listAttachments({ includeDeleted }),
      ]);
      if (!mountedRef.current || request !== requestRef.current) return;
      setStats(nextStats);
      setItems(nextItems);
    } catch (caught) {
      if (mountedRef.current && request === requestRef.current) {
        setError(toErrorMessage(caught));
      }
    } finally {
      if (mountedRef.current && request === requestRef.current) {
        setLoading(false);
      }
    }
  }, [includeDeleted]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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
            await uploadAttachment({ sourcePath, logicalPath: logicalPath.trim() });
            uploaded += 1;
          } catch (caught) {
            failures.push(toErrorMessage(caught));
          }
        }
        await fetchData();
        if (!mountedRef.current) return;
        if (failures.length > 0) {
          setError(`已上传 ${uploaded} 个，${failures.length} 个失败：${failures[0]}`);
        } else {
          setNotice(`已上传 ${uploaded} 个附件`);
        }
      });
    })();
  }, [fetchData, logicalPath, run]);

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
          if (mountedRef.current) setNotice(`已导出「${item.name}」`);
        });
      })();
    },
    [run],
  );

  const verifyItem = useCallback(
    (item: Attachment) => {
      void run(`verify:${item.id}`, async () => {
        const result = await verifyAttachment(item.id);
        if (!mountedRef.current) return;
        if (result.valid) {
          setNotice(`「${item.name}」校验通过`);
        } else {
          setError(`「${item.name}」校验失败：${result.message ?? "内容与元数据不一致"}`);
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
        const result = await deleteAttachment(item.id);
        if (!mountedRef.current) return;
        setPendingDelete(null);
        await fetchData();
        if (!mountedRef.current) return;
        setNotice(
          result.remainingReferences > 0
            ? `已删除「${item.name}」，内容仍被其他附件引用`
            : `已删除「${item.name}」`,
        );
      });
    },
    [fetchData, pendingDelete, run],
  );

  return {
    stats,
    items,
    includeDeleted,
    setIncludeDeleted,
    logicalPath,
    setLogicalPath,
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
    requestDelete,
    disabled: busy !== null || loading,
  };
}
