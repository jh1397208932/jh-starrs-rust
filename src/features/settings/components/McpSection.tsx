import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import { getMcpStatus, regenerateMcpToken, setMcpEnabled } from "@/api/mcp";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import type { McpStatus } from "@/types/ai";

/** 设置 → AI 协作 → MCP 服务：随客户端启停的本机 HTTP 端点与令牌。 */
export function McpSection() {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getMcpStatus());
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await setMcpEnabled(enabled));
    } catch (caught) {
      setError(toErrorMessage(caught));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await regenerateMcpToken());
      setShowToken(true);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string, kind: "url" | "token") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError(t("复制失败，请手动选择文本"));
    }
  };

  const stateLabel = !status
    ? t("加载中")
    : !status.enabled
      ? t("已停用")
      : status.running
        ? t("运行中")
        : t("启动失败");

  return (
    <section aria-label={t("MCP 服务")} className="rounded-md border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Server className="size-3.5 text-[var(--logo-c)]" aria-hidden="true" />
        <h4 className="flex-1 text-[12.5px] font-medium">{t("MCP 服务")}</h4>
        <span className="text-[11.5px] text-muted-foreground">{stateLabel}</span>
        <Switch
          checked={status?.enabled ?? true}
          disabled={!status || busy}
          onCheckedChange={(checked) => void toggle(checked)}
          aria-label={t("启用 MCP 服务")}
        />
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {t("服务随星屿启动与关闭，仅监听本机；agent 通过地址与令牌连接。")}
      </p>

      {error || status?.error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-destructive">
          {error ?? status?.error}
        </p>
      ) : null}

      {status?.running && status.url ? (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[11.5px] text-muted-foreground">{t("服务地址")}</span>
            <code className="min-w-0 flex-1 truncate rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px]">
              {status.url}
            </code>
            <button
              type="button"
              className="mindmap-toolbar-button"
              onClick={() => void copy(status.url ?? "", "url")}
              aria-label={t("复制服务地址")}
              title={t("复制服务地址")}
            >
              {copied === "url" ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-[11.5px] text-muted-foreground">{t("访问令牌")}</span>
            <code className="min-w-0 flex-1 truncate rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px]">
              {showToken ? status.token : `${status.token.slice(0, 6)}…${status.token.slice(-4)}`}
            </code>
            <button
              type="button"
              className="mindmap-toolbar-button"
              onClick={() => setShowToken((current) => !current)}
              aria-label={showToken ? t("隐藏令牌") : t("显示令牌")}
              title={showToken ? t("隐藏令牌") : t("显示令牌")}
            >
              {showToken ? (
                <EyeOff className="size-3.5" aria-hidden="true" />
              ) : (
                <Eye className="size-3.5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="mindmap-toolbar-button"
              onClick={() => void copy(status.token, "token")}
              aria-label={t("复制访问令牌")}
              title={t("复制访问令牌")}
            >
              {copied === "token" ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="mindmap-toolbar-button"
              disabled={busy}
              onClick={() => void regenerate()}
              aria-label={t("重置令牌")}
              title={t("重置令牌后需同步更新 agent 配置")}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
