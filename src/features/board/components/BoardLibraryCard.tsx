import { Layers, Loader2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { type BoardLibraryEntry, useLibraryPreview } from "../hooks/useBoardLibrary";

export interface BoardLibraryCardProps {
  entry: BoardLibraryEntry;
  inserting: boolean;
  onInsert: (entry: BoardLibraryEntry) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, entry: BoardLibraryEntry) => void;
}

/**
 * 组件卡片：进入视口后才生成缩略图，避免大组件库一次性渲染拖死主线程。
 * memo：画板每次保存/状态切换都会重渲染外层，没有这层 memo 会连带重渲染全部 60+ 张卡片。
 */
export const BoardLibraryCard = memo(function BoardLibraryCard({
  entry,
  inserting,
  onInsert,
  onPointerDown,
}: BoardLibraryCardProps) {
  const { t } = useI18n();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false);
  const { url, pending } = useLibraryPreview(entry, visible);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const root = node.closest(".board-library-list");
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setVisible(true);
      },
      { root, rootMargin: "160px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={t("插入组件 {name}", { name: entry.name })}
      title={entry.name}
      onClick={() => onInsert(entry)}
      onPointerDown={(event) => onPointerDown(event, entry)}
      className="board-library-card"
    >
      <span className="board-library-thumb">
        {url ? (
          <img src={url} alt="" draggable={false} loading="lazy" />
        ) : pending ? (
          <span className="board-library-thumb-skeleton" aria-hidden="true" />
        ) : (
          <Layers className="size-4 text-muted-foreground/40" aria-hidden="true" />
        )}
        {inserting ? (
          <span className="absolute inset-0 grid place-items-center bg-card/70 backdrop-blur-[1px]">
            <Loader2 className="size-3.5 animate-spin text-primary" />
          </span>
        ) : null}
      </span>
      <span className="board-library-card-name">{entry.name}</span>
    </button>
  );
});
