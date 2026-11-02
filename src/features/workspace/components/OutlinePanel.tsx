import { ListTree } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { jumpToOutline, useEditorOutline } from "@/features/editor/editorOutline";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";

/**
 * 右侧大纲面板：当前文档的标题层级列表（H1/H2/H3…），点击跳转到对应位置。
 * 与信息面板共用右侧浮窗容器（互斥由调用方状态机保证）。
 */
export function OutlinePanel() {
  const { t } = useI18n();
  const { items } = useEditorOutline();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <ListTree className="size-4 text-muted-foreground" />
        <span className="text-[13.5px] font-semibold">{t("大纲")}</span>
        <span className={cn(CAPTION_CLS, "ml-auto text-muted-foreground")}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <EmptyState
          glyph="☰"
          title={t("暂无标题")}
          description={t("在正文里使用 H1/H2/H3 标题后，会显示在这里")}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1 px-2 py-2">
          <ul aria-label={t("大纲")}>
            {items.map((heading) => (
              <li key={`${heading.id}-${heading.pos}`}>
                <button
                  type="button"
                  onClick={() => jumpToOutline(heading.pos)}
                  aria-label={t("跳转到 {title}", { title: heading.text || t("无标题") })}
                  className={cn(
                    "w-full cursor-default truncate rounded-[8px] px-2 py-1.5 text-left text-[13px] text-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/50",
                    heading.level === 1 && "font-medium",
                    heading.level === 2 && "pl-5",
                    heading.level >= 3 && "pl-8 text-muted-foreground",
                  )}
                >
                  {heading.text || t("无标题")}
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
