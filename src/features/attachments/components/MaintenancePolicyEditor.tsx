import { useEffect, useState } from "react";
import { getMaintenanceSettings, updateMaintenanceSettings } from "@/api/attachment";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { MaintenanceSettings } from "@/types/attachment";

const DEFAULTS: MaintenanceSettings = {
  orphanGraceDays: 7,
  trashRetentionDays: 30,
  stagingMaxAgeHours: 24,
};

const INPUT_CLS =
  "h-[30px] w-full rounded-[7px] border border-input bg-background px-2 text-[12.5px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** 当前工作区的附件保留时间；默认值与旧版硬编码一致。 */
export function MaintenancePolicyEditor() {
  const { t } = useI18n();
  const [form, setForm] = useState<MaintenanceSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getMaintenanceSettings()
      .then((settings) => {
        if (active) setForm(settings);
      })
      .catch((error) => {
        if (active) {
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

  const update = (key: keyof MaintenanceSettings, raw: string) => {
    setMessage(null);
    setFailed(false);
    setForm((current) => ({ ...current, [key]: Number(raw) }));
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setFailed(false);
    try {
      const saved = await updateMaintenanceSettings(form);
      setForm(saved);
      setMessage(t("已保存"));
    } catch (error) {
      setFailed(true);
      setMessage(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/25 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <h5 className="text-[12.5px] font-semibold">{t("保留时间")}</h5>
        <Button size="sm" variant="ghost" disabled={loading || saving} onClick={() => void save()}>
          {saving ? t("保存中…") : t("保存")}
        </Button>
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
              disabled={loading || saving}
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
              disabled={loading || saving}
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
              disabled={loading || saving}
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
