import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getMaintenanceSettings, updateMaintenanceSettings } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { MaintenanceSettings } from "@/types/attachment";

const DEFAULTS: MaintenanceSettings = {
  orphanGraceDays: 7,
  trashRetentionDays: 30,
  stagingMaxAgeHours: 24,
};

const INPUT_CLS =
  "h-[30px] w-full rounded-[7px] border border-input bg-background px-2 text-[12.5px] tabular-nums outline-none";

/** 停止输入多久后落库：改完即生效，但不在每个按键上打一次库。 */
const SAVE_DELAY_MS = 600;

/** 三项的取值范围，与 Rust 侧校验保持一致（越界不落库）。 */
const RANGES: Record<keyof MaintenanceSettings, readonly [number, number]> = {
  orphanGraceDays: [1, 365],
  trashRetentionDays: [1, 365],
  stagingMaxAgeHours: [1, 168],
};

/**
 * 当前工作区的附件保留时间；默认值与旧版硬编码一致。
 *
 * 改完即生效：输入停止 600 ms 自动保存，关闭弹窗时若还有未落库的改动会立即补写。
 * 失败时保留用户输入并显示原因，不清回旧值。
 */
export function MaintenancePolicyEditor() {
  const { t } = useI18n();
  const [form, setForm] = useState<MaintenanceSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // 读取失败时不允许编辑：否则一次输入就会把默认值写回并覆盖真实配置。
  const [loadFailed, setLoadFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<MaintenanceSettings | null>(null);
  const editSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    getMaintenanceSettings()
      .then((settings) => {
        if (active) setForm(settings);
      })
      .catch((error) => {
        if (active) {
          setLoadFailed(true);
          setFailed(true);
          setMessage(toErrorMessage(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // 卸载（关闭设置弹窗）时补写最后一批改动，避免「改完立刻关」丢掉输入。
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        void updateMaintenanceSettings(pending).catch(() => undefined);
      }
    },
    [],
  );

  const persist = async (next: MaintenanceSettings) => {
    const seq = editSeqRef.current;
    pendingRef.current = null;
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const saved = await updateMaintenanceSettings(next);
      // 请求期间用户又改了值：不要用旧响应覆盖新输入。
      if (editSeqRef.current === seq) setForm(saved);
      setFailed(false);
      setMessage(t("已保存"));
    } catch (error) {
      setFailed(true);
      setMessage(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof MaintenanceSettings, raw: string) => {
    const value = Number(raw);
    const next = { ...form, [key]: value };
    editSeqRef.current += 1;
    setForm(next);
    setMessage(null);
    setFailed(false);

    const [min, max] = RANGES[key];
    if (!Number.isInteger(value) || value < min || value > max) {
      setFailed(true);
      setMessage(t("需在 {min}–{max} 之间", { min, max }));
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persist(next);
    }, SAVE_DELAY_MS);
  };

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-[12.5px] font-semibold">{t("保留时间")}</h5>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          {saving ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              {t("保存中…")}
            </>
          ) : (
            t("修改后自动生效")
          )}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="block text-[11px] text-muted-foreground">
          {t("未使用")}
          <span className="mt-1 flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={365}
              value={form.orphanGraceDays}
              disabled={loading || loadFailed}
              aria-label={t("未使用附件保留天数")}
              onChange={(event) => update("orphanGraceDays", event.target.value)}
              className={INPUT_CLS}
            />
            {t("天")}
          </span>
        </label>
        <label className="block text-[11px] text-muted-foreground">
          {t("回收站")}
          <span className="mt-1 flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={365}
              value={form.trashRetentionDays}
              disabled={loading || loadFailed}
              aria-label={t("回收站保留天数")}
              onChange={(event) => update("trashRetentionDays", event.target.value)}
              className={INPUT_CLS}
            />
            {t("天")}
          </span>
        </label>
        <label className="block text-[11px] text-muted-foreground">
          {t("临时文件")}
          <span className="mt-1 flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={168}
              value={form.stagingMaxAgeHours}
              disabled={loading || loadFailed}
              aria-label={t("临时文件保留小时数")}
              onChange={(event) => update("stagingMaxAgeHours", event.target.value)}
              className={INPUT_CLS}
            />
            {t("小时")}
          </span>
        </label>
      </div>
      {message && (
        <p role="status" className={cn(CAPTION_CLS, "mt-1.5", failed ? "text-destructive" : "text-primary")}>
          {message}
        </p>
      )}
    </div>
  );
}
