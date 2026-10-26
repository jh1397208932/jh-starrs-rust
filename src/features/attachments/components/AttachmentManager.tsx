import { FileText, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { AttachmentStats } from "@/types/attachment";
import { useAttachmentManager } from "../hooks/useAttachmentManager";
import { formatAttachmentBytes } from "../utils/format";
import { AttachmentRow } from "./AttachmentRow";
import { MaintenancePolicyEditor } from "./MaintenancePolicyEditor";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatsGrid({ stats }: { stats: AttachmentStats }) {
  const { t } = useI18n();
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell label={t("活跃")} value={`${stats.activeCount}`} />
        <StatCell label={t("已关联")} value={`${stats.linkedCount}`} />
        <StatCell label={t("回收站")} value={`${stats.trashCount}`} />
        <StatCell label={t("占用空间")} value={formatAttachmentBytes(stats.diskBytes)} />
      </div>
      <p className={cn(CAPTION_CLS, "mt-2 text-muted-foreground")}>
        {t("可回收")} {formatAttachmentBytes(stats.reclaimableBytes)} {t("· 未关联")} {stats.unlinkedCount}{" "}
        {t("· 最近维护")} {stats.lastMaintenanceAt ? formatTimestamp(stats.lastMaintenanceAt) : t("尚未执行")}
        {stats.diskFreeBytes !== null
          ? t(" · 剩余空间 {size}", { size: formatAttachmentBytes(stats.diskFreeBytes) })
          : ""}
      </p>
    </>
  );
}

/**
 * 设置 → 存储：工作区附件管理器。
 *
 * 数据与动作在 useAttachmentManager；本组件只负责布置统计、工具条与列表。
 */
export function AttachmentManager() {
  const { t } = useI18n();
  const manager = useAttachmentManager();
  const { stats, items, loading, busy, error, notice } = manager;

  return (
    <section className="mt-5" aria-label={t("附件管理")} aria-busy={busy !== null}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[13.5px] font-semibold">{t("附件")}</h4>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={manager.includeDeleted ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={manager.includeDeleted}
            onClick={() => manager.setIncludeDeleted((value) => !value)}
          >
            {t("回收站")}
          </Button>
          <Button variant="ghost" size="sm" disabled={manager.disabled} onClick={manager.maintain}>
            {busy === "maintenance" ? t("清理中…") : t("立即清理")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("刷新附件列表")}
            title={t("刷新")}
            disabled={loading || manager.disabled}
            onClick={manager.refresh}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {stats && <StatsGrid stats={stats} />}
      <MaintenancePolicyEditor />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="attachment-search" className="sr-only">
          {t("搜索附件")}
        </label>
        <input
          id="attachment-search"
          value={manager.search}
          onChange={(event) => manager.setSearch(event.target.value)}
          placeholder={t("搜索附件")}
          className="h-[31px] w-40 rounded-[8px] border border-input bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <label htmlFor="attachment-logical-path" className="sr-only">
          {t("上传目录")}
        </label>
        <input
          id="attachment-logical-path"
          value={manager.logicalPath}
          onChange={(event) => manager.setLogicalPath(event.target.value)}
          placeholder={t("目录（可选）")}
          className="h-[31px] w-40 rounded-[8px] border border-input bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <label htmlFor="attachment-ttl" className="sr-only">
          {t("上传保留时间")}
        </label>
        <select
          id="attachment-ttl"
          value={manager.ttlSeconds ?? ""}
          disabled={manager.disabled}
          onChange={(event) => manager.setTtlSeconds(event.target.value ? Number(event.target.value) : null)}
          className="h-[31px] rounded-[8px] border border-input bg-background px-2 text-[12px] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <option value="">{t("永久保留")}</option>
          <option value="86400">{t("保留 1 天")}</option>
          <option value="604800">{t("保留 7 天")}</option>
          <option value="2592000">{t("保留 30 天")}</option>
        </select>
        <Button size="sm" onClick={manager.upload} disabled={manager.disabled}>
          {busy === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {busy === "upload" ? t("上传中…") : t("上传")}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px]"
        >
          <span>{error}</span>
          <button
            type="button"
            aria-label={t("关闭错误提示")}
            className="rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => manager.setError(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className={cn(CAPTION_CLS, "mt-3 text-primary")}>
          {notice}
        </p>
      )}

      <div className="mt-3 max-h-[230px] overflow-y-auto rounded-md border border-border/70">
        {loading && items.length === 0 ? (
          <div className="grid h-24 place-items-center text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" /> {t("正在读取附件…")}
            </span>
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-24 place-items-center px-4 text-center">
            <div>
              <FileText className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-1 text-[12.5px] text-muted-foreground">{t("还没有附件")}</p>
            </div>
          </div>
        ) : (
          <ul aria-label={t("附件列表")}>
            {items.map((item) => (
              <AttachmentRow
                key={item.id}
                item={item}
                busy={busy}
                pendingDelete={manager.pendingDelete}
                disabled={manager.disabled}
                onCancelDelete={manager.cancelDelete}
                onDelete={manager.requestDelete}
                onExport={manager.exportItem}
                onVerify={manager.verifyItem}
                onRestore={manager.restoreItem}
              />
            ))}
            {manager.hasMore && (
              <li className="p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={manager.loadingMore}
                  onClick={manager.loadMore}
                >
                  {manager.loadingMore ? t("加载中…") : t("加载更多")}
                </Button>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
