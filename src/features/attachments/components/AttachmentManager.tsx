import { FileText, HardDrive, Loader2, Package, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { AttachmentStats } from "@/types/attachment";
import { useAttachmentManager } from "../hooks/useAttachmentManager";
import { formatAttachmentBytes } from "../utils/format";
import { AttachmentRow } from "./AttachmentRow";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
      <p className="text-[10.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatsGrid({ stats }: { stats: AttachmentStats }) {
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell label="活跃附件" value={`${stats.activeCount}`} />
        <StatCell label="逻辑大小" value={formatAttachmentBytes(stats.logicalBytes)} />
        <StatCell label="物理占用" value={formatAttachmentBytes(stats.physicalBytes)} />
        <StatCell label="唯一对象" value={`${stats.uniqueObjects}`} />
      </div>
      <p
        className={cn(CAPTION_CLS, "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground")}
      >
        <span className="inline-flex items-center gap-1">
          <HardDrive className="size-3" /> big {stats.bigObjects}
        </span>
        <span className="inline-flex items-center gap-1">
          <Package className="size-3" /> pack 对象 {stats.packObjects}
        </span>
        <span>pack 文件 {stats.packCount}</span>
        <span>死字节 {formatAttachmentBytes(stats.deadPackBytes)}</span>
        {stats.deletedCount > 0 && <span>已删除 {stats.deletedCount}</span>}
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
  const manager = useAttachmentManager();
  const { stats, items, loading, busy, error, notice } = manager;

  return (
    <section className="mt-5" aria-label="附件管理" aria-busy={busy !== null}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[13.5px] font-semibold">附件</h4>
          <p className={cn(CAPTION_CLS, "mt-0.5 text-muted-foreground")}>
            内容按 BLAKE3 寻址；小文件进入 pack，删除在无引用后清理。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant={manager.includeDeleted ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={manager.includeDeleted}
            onClick={() => manager.setIncludeDeleted((value) => !value)}
          >
            含已删除
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新附件列表"
            title="刷新"
            disabled={loading || manager.disabled}
            onClick={manager.refresh}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {stats && <StatsGrid stats={stats} />}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="attachment-logical-path" className="sr-only">
          上传到的逻辑目录
        </label>
        <input
          id="attachment-logical-path"
          value={manager.logicalPath}
          onChange={(event) => manager.setLogicalPath(event.target.value)}
          placeholder="逻辑目录（可选）"
          className="h-[31px] w-40 rounded-[8px] border border-input bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Button size="sm" onClick={manager.upload} disabled={manager.disabled}>
          {busy === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {busy === "upload" ? "上传中…" : "选择文件上传"}
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
            aria-label="关闭错误提示"
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
              <Loader2 className="size-3.5 animate-spin" /> 正在读取附件…
            </span>
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-24 place-items-center px-4 text-center">
            <div>
              <FileText className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-1 text-[12.5px] text-muted-foreground">还没有附件</p>
              <p className="text-[11px] text-muted-foreground/80">选择文件后按内容哈希存入工作区 storage/</p>
            </div>
          </div>
        ) : (
          <ul aria-label="附件列表">
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
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
