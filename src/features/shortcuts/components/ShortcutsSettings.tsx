import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import {
  ALL_SHORTCUT_ACTIONS,
  APP_SHORTCUT_ACTIONS,
  BOARD_SHORTCUT_ACTIONS,
  BUILTIN_SHORTCUTS,
  EDITOR_SHORTCUT_ACTIONS,
} from "../actions";
import { useShortcutConfig } from "../ShortcutProvider";
import {
  bindingLabel,
  findCrossScopeConflict,
  findSameScopeConflict,
  validateBinding,
} from "../shortcutKeys";
import type { ShortcutAction, ShortcutScope } from "../types";
import { ShortcutRow } from "./ShortcutRow";

const SCOPE_LABELS: Record<ShortcutScope, string> = {
  app: "应用",
  editor: "编辑器",
  board: "画板",
};

const GROUPS: { scope: ShortcutScope; actions: ShortcutAction[]; note: string }[] = [
  { scope: "app", actions: APP_SHORTCUT_ACTIONS, note: "星屿窗口内任意页面生效。" },
  { scope: "editor", actions: EDITOR_SHORTCUT_ACTIONS, note: "文档编辑器获得焦点时生效。" },
  { scope: "board", actions: BOARD_SHORTCUT_ACTIONS, note: "画板获得焦点时生效；原生绘图键位见下方只读区。" },
];

/** 设置 → 快捷键：总开关、作用域、搜索、录制与冲突提示。 */
export function ShortcutsSettings() {
  const { t } = useI18n();
  const { config, loading, saving, loadError, saveError, updateConfig, resetConfig } = useShortcutConfig();
  const [query, setQuery] = useState("");
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      actions: group.actions.filter((action) => t(action.label).toLowerCase().includes(keyword)),
    })).filter((group) => group.actions.length > 0);
  }, [query, t]);

  const updateScope = (scope: ShortcutScope, enabled: boolean) => {
    updateConfig({ ...config, scopes: { ...config.scopes, [scope]: enabled } });
  };

  const commitBinding = (action: ShortcutAction, binding: string): boolean => {
    const validation = validateBinding(binding, action.scope);
    if (!validation.ok) {
      setRecorderError(validation.message ?? t("组合键无效"));
      return false;
    }
    const conflict = findSameScopeConflict(
      ALL_SHORTCUT_ACTIONS,
      config.bindings,
      action.id,
      action.scope,
      binding,
    );
    if (conflict) {
      setRecorderError(t("与「{label}」冲突", { label: t(conflict.label) }));
      return false;
    }
    updateConfig({
      ...config,
      bindings: { ...config.bindings, [action.id]: binding },
    });
    setRecordingId(null);
    setRecorderError(null);
    return true;
  };

  const resetAction = (action: ShortcutAction) => {
    updateConfig({
      ...config,
      bindings: { ...config.bindings, [action.id]: action.defaultBinding },
    });
    setRecordingId(null);
    setRecorderError(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold">{t("快捷键")}</h3>
          <p className={`${CAPTION_CLS} mt-0.5 text-muted-foreground`}>
            {t("应用内生效；基础输入与输入法组合键不受影响。")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted-foreground">
            {config.enabled ? t("已启用") : t("已关闭")}
          </span>
          <Switch
            checked={config.enabled}
            aria-label={t("启用快捷键")}
            disabled={loading}
            onCheckedChange={(enabled) => updateConfig({ ...config, enabled })}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(["app", "editor", "board"] as const).map((scope) => (
          <Button
            key={scope}
            size="sm"
            variant={config.scopes[scope] ? "secondary" : "ghost"}
            aria-pressed={config.scopes[scope]}
            disabled={!config.enabled || loading}
            onClick={() => updateScope(scope, !config.scopes[scope])}
          >
            {t(SCOPE_LABELS[scope])}
            {!config.scopes[scope] ? t(" · 关") : ""}
          </Button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索快捷键…")}
            aria-label={t("搜索快捷键")}
            className="h-8 w-[180px] rounded-[8px] border border-input bg-background pr-2.5 pl-8 text-[12px] outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => {
            resetConfig();
            setRecordingId(null);
            setRecorderError(null);
          }}
        >
          {t("恢复默认")}
        </Button>
      </div>

      {(loadError || saveError) && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2 text-[12px] text-destructive"
        >
          {saveError ?? loadError}
        </p>
      )}
      {saving && <p className="mt-2 text-[11px] text-muted-foreground">{t("保存中…")}</p>}

      <div className="mt-4 space-y-4">
        {filtered.map((group) => (
          <section key={group.scope}>
            <div className="flex items-baseline justify-between gap-3 px-2">
              <h4 className="text-[12.5px] font-semibold text-foreground">{t(SCOPE_LABELS[group.scope])}</h4>
              <span className="text-[10.5px] text-muted-foreground">{t(group.note)}</span>
            </div>
            <ul className="mt-1">
              {group.actions.map((action) => {
                const binding = config.bindings[action.id] ?? "";
                const same = findSameScopeConflict(
                  ALL_SHORTCUT_ACTIONS,
                  config.bindings,
                  action.id,
                  action.scope,
                  binding,
                );
                const cross = findCrossScopeConflict(
                  ALL_SHORTCUT_ACTIONS,
                  config.bindings,
                  action.id,
                  action.scope,
                  binding,
                );
                return (
                  <ShortcutRow
                    key={action.id}
                    action={action}
                    binding={binding}
                    recording={recordingId === action.id}
                    error={
                      recordingId === action.id
                        ? recorderError
                        : same
                          ? t("与「{label}」冲突", { label: t(same.label) })
                          : null
                    }
                    warning={
                      !same && cross
                        ? t("与{scope}「{label}」重复，当前作用域优先", {
                            scope: t(SCOPE_LABELS[cross.scope]),
                            label: t(cross.label),
                          })
                        : null
                    }
                    onStartRecord={() => {
                      setRecordingId(action.id);
                      setRecorderError(null);
                    }}
                    onCancelRecord={() => {
                      setRecordingId(null);
                      setRecorderError(null);
                    }}
                    onCommit={(next) => commitBinding(action, next)}
                    onReset={() => resetAction(action)}
                  />
                );
              })}
            </ul>
          </section>
        ))}
        {filtered.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted-foreground">{t("没有匹配的快捷键")}</p>
        )}
      </div>

      <section className="mt-5 rounded-[10px] border border-border/70 bg-muted/25 p-3">
        <p className="text-[12px] font-medium text-foreground">{t("内置快捷键")}</p>
        <p className="mt-0.5 text-[10.5px] text-muted-foreground">
          {t("由编辑器或 Excalidraw 提供，暂不可修改。")}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {BUILTIN_SHORTCUTS.map((item) => (
            <div key={`${item.group}-${t(item.label)}`} className="flex items-center justify-between gap-2">
              <span className="truncate text-[11.5px] text-muted-foreground">{t(item.label)}</span>
              <span className={cn("flex shrink-0 gap-0.5", "text-[10px]")}>
                {item.keys.map((key) => (
                  <span
                    key={`${t(item.label)}-${key}`}
                    className="rounded-sm border border-border/60 bg-card px-1 py-0.5 font-mono"
                  >
                    {key}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-3 text-[10.5px] text-muted-foreground">
        {t("当前为应用内快捷键；系统级全局热键尚未启用。画板原生键位不受本页改键影响。")}
      </p>
      {config.enabled && (
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          {t("示例：")}
          {bindingLabel(config.bindings["app.newNode"] ?? "")} {t("新建，")}
          {bindingLabel(config.bindings["board.save"] ?? "")} {t("保存画板。")}
        </p>
      )}
    </div>
  );
}
