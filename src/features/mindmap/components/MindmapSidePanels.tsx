import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";
import { STYLE_PALETTE } from "./stylePalette";

/** 关系线编辑器：标签、颜色与删除。 */
export function MindmapRelationshipEditor({
  relationship,
  onChange,
  onDelete,
}: {
  relationship: { id: string; label?: string; color?: string };
  onChange: (patch: { label?: string; color?: string }) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="mindmap-inspector" aria-label={t("关系线")}>
      <h2>{t("关系线")}</h2>
      <label htmlFor="mindmap-relation-label">{t("标签")}</label>
      <input
        id="mindmap-relation-label"
        value={relationship.label ?? ""}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <fieldset className="mindmap-style-group">
        <legend>{t("颜色")}</legend>
        <div className="mindmap-swatch-row">
          <button
            type="button"
            className="mindmap-swatch is-auto"
            data-on={(relationship.color ?? "auto") === "auto"}
            onClick={() => onChange({ color: "auto" })}
          >
            {t("自动")}
          </button>
          {STYLE_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              className="mindmap-swatch"
              style={{ background: color }}
              data-on={relationship.color === color}
              aria-label={`${t("关系线颜色")} ${color}`}
              onClick={() => onChange({ color })}
            />
          ))}
        </div>
      </fieldset>
      <button type="button" className="mindmap-danger-button" onClick={onDelete}>
        {t("删除关系线")}
      </button>
    </aside>
  );
}

/** 外框/概要编辑器：标签（仅外框）、颜色与删除。 */
export function MindmapFrameEditor({
  label,
  color,
  isSummary,
  onLabel,
  onColor,
  onDelete,
}: {
  label?: string;
  color?: string;
  isSummary: boolean;
  onLabel: (label: string) => void;
  onColor: (color: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="mindmap-inspector" aria-label={isSummary ? t("概要") : t("外框")}>
      <h2>{isSummary ? t("概要") : t("外框")}</h2>
      {isSummary ? null : (
        <>
          <label htmlFor="mindmap-frame-label">{t("标签")}</label>
          <input id="mindmap-frame-label" value={label ?? ""} onChange={(e) => onLabel(e.target.value)} />
        </>
      )}
      <fieldset className="mindmap-style-group">
        <legend>{t("颜色")}</legend>
        <div className="mindmap-swatch-row">
          <button
            type="button"
            className="mindmap-swatch is-auto"
            data-on={(color ?? "auto") === "auto"}
            onClick={() => onColor("auto")}
          >
            {t("自动")}
          </button>
          {STYLE_PALETTE.map((paletteColor) => (
            <button
              key={paletteColor}
              type="button"
              className="mindmap-swatch"
              style={{ background: paletteColor }}
              data-on={color === paletteColor}
              aria-label={`${t("颜色")} ${paletteColor}`}
              onClick={() => onColor(paletteColor)}
            />
          ))}
        </div>
      </fieldset>
      <button type="button" className="mindmap-danger-button" onClick={onDelete}>
        {isSummary ? t("删除概要") : t("删除外框")}
      </button>
    </aside>
  );
}

export function MindmapSearch({
  value,
  results,
  onChange,
  onClose,
  onPick,
}: {
  value: string;
  results: MindmapTopic[];
  onChange: (value: string) => void;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mindmap-search" role="dialog" aria-label={t("搜索主题")}>
      <input
        value={value}
        placeholder={t("输入主题、备注或标签")}
        aria-label={t("搜索主题")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
          if (event.key === "Enter" && results[0]) onPick(results[0].id);
        }}
      />
      <div className="mindmap-search__results">
        {results.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className="mindmap-search__result"
            onClick={() => onPick(topic.id)}
          >
            {topic.text || t("无标题主题")}
          </button>
        ))}
        {value.trim() && results.length === 0 ? (
          <div className="mindmap-search__result">{t("没有匹配主题")}</div>
        ) : null}
      </div>
    </div>
  );
}
