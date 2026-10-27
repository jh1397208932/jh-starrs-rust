/**
 * 主题样式字段：边框颜色/形状/粗细、填充、贴纸与标记。
 *
 * 与检查器壳分离，字段多但不影响备注/链接等基础信息的布局。
 */

import { useI18n } from "@/lib/i18n";
import type { MindmapBorderShape, MindmapBorderWidth, MindmapTopic } from "@/types/mindmap";
import { MARKER_GROUPS, STICKER_PALETTE, STYLE_PALETTE } from "./stylePalette";

export interface MindmapStyleFieldsProps {
  topic: MindmapTopic;
  onChange: (patch: Partial<MindmapTopic>, field: string) => void;
}

export function MindmapStyleFields({ topic, onChange }: MindmapStyleFieldsProps) {
  const { t } = useI18n();
  const style = topic.style ?? {};
  const setStyle = (patch: Partial<NonNullable<MindmapTopic["style"]>>) => {
    const next: NonNullable<MindmapTopic["style"]> = {
      borderColor: "auto",
      borderShape: "rounded",
      fill: "auto",
      borderWidth: "normal",
      ...style,
      ...patch,
    };
    onChange({ style: next }, "style");
  };
  const toggleMarker = (marker: string) => {
    const markers = topic.markers ?? [];
    const next = markers.includes(marker)
      ? markers.filter((item) => item !== marker)
      : [...markers, marker].slice(0, 12);
    onChange({ markers: next }, "markers");
  };
  return (
    <>
      <fieldset className="mindmap-style-group">
        <legend>{t("边框颜色")}</legend>
        <div className="mindmap-swatch-row">
          <button
            type="button"
            className="mindmap-swatch is-auto"
            data-on={(style.borderColor ?? "auto") === "auto"}
            aria-label={t("跟随分支")}
            onClick={() => setStyle({ borderColor: "auto" })}
          >
            {t("自动")}
          </button>
          <div className="mindmap-swatch-grid">
            {STYLE_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className="mindmap-swatch"
                style={{ background: color }}
                data-on={style.borderColor === color}
                aria-label={`${t("边框颜色")} ${color}`}
                onClick={() => setStyle({ borderColor: color })}
              />
            ))}
          </div>
        </div>
      </fieldset>
      <fieldset className="mindmap-style-group">
        <legend>{t("边框形状")}</legend>
        <div className="mindmap-segment-row">
          {(["rounded", "underline", "pill", "plain"] as MindmapBorderShape[]).map((shape) => (
            <button
              key={shape}
              type="button"
              data-on={(style.borderShape ?? "rounded") === shape}
              onClick={() => setStyle({ borderShape: shape })}
            >
              {t(
                shape === "rounded"
                  ? "圆角"
                  : shape === "underline"
                    ? "下划线"
                    : shape === "pill"
                      ? "胶囊"
                      : "直角",
              )}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mindmap-style-group">
        <legend>{t("边框粗细")}</legend>
        <div className="mindmap-segment-row">
          {(["thin", "normal", "bold"] as MindmapBorderWidth[]).map((width) => (
            <button
              key={width}
              type="button"
              data-on={(style.borderWidth ?? "normal") === width}
              onClick={() => setStyle({ borderWidth: width })}
            >
              {t(width === "thin" ? "细" : width === "normal" ? "常规" : "加粗")}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mindmap-style-group">
        <legend>{t("填充")}</legend>
        <div className="mindmap-swatch-row">
          <button
            type="button"
            className="mindmap-swatch is-auto"
            data-on={(style.fill ?? "auto") === "auto"}
            aria-label={t("跟随主题")}
            onClick={() => setStyle({ fill: "auto" })}
          >
            {t("自动")}
          </button>
          <div className="mindmap-swatch-grid">
            {STYLE_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                className="mindmap-swatch"
                style={{ background: `${color}59` }}
                data-on={style.fill === color}
                aria-label={`${t("填充")} ${color}`}
                onClick={() => setStyle({ fill: color })}
              />
            ))}
          </div>
        </div>
      </fieldset>
      <fieldset className="mindmap-style-group">
        <legend>{t("贴纸")}</legend>
        <div className="mindmap-marker-row">
          {STICKER_PALETTE.map((sticker) => {
            const active = (topic.stickers ?? []).includes(sticker.id);
            return (
              <button
                key={sticker.id}
                type="button"
                className="mindmap-marker-button"
                style={{ color: sticker.color }}
                data-on={active}
                aria-label={sticker.id}
                aria-pressed={active}
                onClick={() => {
                  const current = topic.stickers ?? [];
                  const next = active
                    ? current.filter((item) => item !== sticker.id)
                    : [...current, sticker.id].slice(0, 8);
                  onChange({ stickers: next }, "stickers");
                }}
              >
                {sticker.glyph}
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="mindmap-style-group">
        <legend>{t("标记")}</legend>
        {MARKER_GROUPS.map((group) => (
          <div key={group.label} className="mindmap-marker-group">
            <span className="mindmap-marker-group__label">{t(group.label)}</span>
            <div className="mindmap-marker-row">
              {group.markers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className="mindmap-marker-button"
                  style={{ color: marker.color }}
                  data-on={(topic.markers ?? []).includes(marker.id)}
                  aria-label={`${t(group.label)} ${marker.text ?? marker.glyph ?? ""}`}
                  aria-pressed={(topic.markers ?? []).includes(marker.id)}
                  title={`${t(group.label)} ${marker.text ?? marker.glyph ?? ""}`}
                  onClick={() => toggleMarker(marker.id)}
                >
                  {marker.text ?? marker.glyph}
                </button>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
    </>
  );
}
