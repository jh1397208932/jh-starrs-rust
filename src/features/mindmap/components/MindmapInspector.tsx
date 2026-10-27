import { ImagePlus, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MindmapTopic } from "@/types/mindmap";
import { MindmapStyleFields } from "./MindmapStyleFields";

/** 主题检查器外壳：基础字段与关闭；样式与标记交给独立字段组件。 */
export function MindmapInspector({
  topic,
  onChange,
  onImage,
  onClose,
}: {
  topic: MindmapTopic;
  onChange: (patch: Partial<MindmapTopic>, field: string) => void;
  onImage: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="mindmap-inspector" aria-label={t("主题检查器")}>
      <div className="mindmap-inspector__header">
        <h2>{t("主题")}</h2>
        <button
          type="button"
          className="mindmap-inspector__close"
          onClick={onClose}
          aria-label={t("收起详情")}
          title={t("收起详情")}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <label htmlFor={`mindmap-note-${topic.id}`}>{t("备注")}</label>
      <textarea
        id={`mindmap-note-${topic.id}`}
        aria-label={t("备注")}
        value={topic.note ?? ""}
        onChange={(e) => onChange({ note: e.target.value }, "note")}
      />
      <label htmlFor={`mindmap-labels-${topic.id}`}>{t("标签")}</label>
      <input
        id={`mindmap-labels-${topic.id}`}
        aria-label={t("标签")}
        value={(topic.labels ?? []).join(", ")}
        onChange={(e) =>
          onChange(
            {
              labels: e.target.value
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
            },
            "labels",
          )
        }
      />
      <label htmlFor={`mindmap-link-${topic.id}`}>{t("超链接")}</label>
      <input
        id={`mindmap-link-${topic.id}`}
        aria-label={t("超链接")}
        value={topic.link ?? ""}
        onChange={(e) => onChange({ link: e.target.value }, "link")}
        placeholder="https://"
      />
      <label htmlFor={`mindmap-image-${topic.id}`} className="mindmap-image-field">
        <ImagePlus className="size-3.5" aria-hidden="true" />
        {topic.image ? t("更换图片") : t("选择图片")}
      </label>
      <input
        id={`mindmap-image-${topic.id}`}
        className="mindmap-image-input"
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // 清空 value 让同一文件可再次选择；取消选择时不要上传空文件。
          e.target.value = "";
          if (file) void onImage(file);
        }}
      />
      <MindmapStyleFields topic={topic} onChange={onChange} />
    </aside>
  );
}
