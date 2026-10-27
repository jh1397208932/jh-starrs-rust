import { Check, Loader2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { approveAiInbox, getAiPermissions, listAiInbox, rejectAiInbox, setAiPermissions } from "@/api/ai";
import { toErrorMessage } from "@/api/client";
import { useI18n } from "@/lib/i18n";
import type { AiInboxItem, AiPermissionMode, AiPermissions } from "@/types/ai";
import { McpSection } from "./McpSection";

const MODES: { id: AiPermissionMode; label: string; hint: string }[] = [
  { id: "read-only", label: "只读", hint: "agent 只能读取，写入一律拒绝" },
  { id: "review", label: "需人工确认", hint: "写入进入待审区，确认后才落库（默认）" },
  { id: "editable", label: "可编辑", hint: "低/中风险直接写入并审计；高风险仍需确认" },
];

const SCOPES: { key: keyof AiPermissions; label: string }[] = [
  { key: "doc", label: "文档" },
  { key: "board", label: "画板" },
  { key: "mindmap", label: "思维导图" },
];

/** 设置 → AI 协作：作用域写权限 + 待审区。 */
export function AiSection() {
  const { t } = useI18n();
  const [permissions, setPermissions] = useState<AiPermissions | null>(null);
  const [inbox, setInbox] = useState<AiInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextPermissions, pending] = await Promise.all([getAiPermissions(), listAiInbox("pending")]);
      setPermissions(nextPermissions);
      setInbox(pending);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const changeMode = async (scope: keyof AiPermissions, mode: AiPermissionMode) => {
    if (!permissions) return;
    const next = { ...permissions, [scope]: mode };
    setPermissions(next);
    try {
      await setAiPermissions(next);
    } catch (caught) {
      setError(toErrorMessage(caught));
      void refresh();
    }
  };

  const decide = async (id: string, approve: boolean) => {
    setBusyId(id);
    setError(null);
    try {
      if (approve) await approveAiInbox(id);
      else await rejectAiInbox(id);
      await refresh();
    } catch (caught) {
      setError(toErrorMessage(caught));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-semibold">{t("AI 协作")}</h3>
        <button
          type="button"
          className="mindmap-toolbar-button"
          onClick={() => void refresh()}
          aria-label={t("刷新")}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
        {t("通过客户端内置的 MCP 服务把工作区开放给 AI；写入按作用域权限执行，高风险操作必须人工确认。")}
      </p>

      <div className="mt-3">
        <McpSection />
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        >
          {error}
        </div>
      ) : null}

      {loading && !permissions ? (
        <div className="mt-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {t("加载中")}
        </div>
      ) : null}

      {permissions ? (
        <div className="mt-4 space-y-4">
          {SCOPES.map((scope) => (
            <fieldset key={scope.key}>
              <legend className="text-[12.5px] font-medium">{t(scope.label)}</legend>
              <div className="mt-1.5 space-y-1">
                {MODES.map((mode) => (
                  <label
                    key={mode.id}
                    className="flex cursor-default items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent/60"
                  >
                    <input
                      type="radio"
                      name={`ai-permission-${scope.key}`}
                      checked={permissions[scope.key] === mode.id}
                      onChange={() => void changeMode(scope.key, mode.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="text-[12.5px]">{t(mode.label)}</span>
                      <span className="ml-2 text-[11.5px] text-muted-foreground">{t(mode.hint)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <section aria-label={t("待审区")}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="size-3.5 text-[var(--logo-c)]" aria-hidden="true" />
              <h4 className="text-[12.5px] font-medium">{t("待审区")}</h4>
              <span className="text-[11.5px] text-muted-foreground">
                {t("待确认 {count} 条", { count: inbox.length })}
              </span>
            </div>
            {inbox.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted-foreground">{t("没有待确认的 AI 写入")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {inbox.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border/70 bg-card px-2.5 py-2 text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{item.tool}</span>
                      <span
                        className={
                          item.risk === "high"
                            ? "rounded-full border border-destructive/40 px-1.5 text-[10.5px] text-destructive"
                            : "rounded-full border border-border px-1.5 text-[10.5px] text-muted-foreground"
                        }
                      >
                        {t(item.risk === "high" ? "高风险" : item.risk === "medium" ? "中风险" : "低风险")}
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        className="mindmap-toolbar-button"
                        disabled={busyId === item.id}
                        onClick={() => void decide(item.id, true)}
                        aria-label={t("通过并写入")}
                        title={t("通过并写入")}
                      >
                        {busyId === item.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="size-3.5" aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        className="mindmap-toolbar-button"
                        disabled={busyId === item.id}
                        onClick={() => void decide(item.id, false)}
                        aria-label={t("拒绝")}
                        title={t("拒绝")}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="mt-1 text-[12px]">{item.summary || t("未填写动机")}</p>
                    <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-secondary/60 p-1.5 font-mono text-[10.5px] text-muted-foreground">
                      {item.payloadJson}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
