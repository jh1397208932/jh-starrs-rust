import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { SPRING_PANEL } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface InfoFloatProps {
  /** 是否展开（文档标签独占；其他标签类型由调用方收敛为 false） */
  visible: boolean;
  /** 把手/展开钮统一开关回调 */
  onToggle: () => void;
  /** 浮窗内容（InfoPanel） */
  children: ReactNode;
}

/**
 * 信息浮窗容器：文档独有附加浮层，悬浮于内容区右上（absolute，不占主布局）。
 * 展开 = 右滑弹簧入场 + 左缘骑缝把手（收起）；折叠 = 右缘小钮（展开）。
 */
export function InfoFloat({ visible, onToggle, children }: InfoFloatProps) {
  const { t } = useI18n();
  return (
    <>
      <AnimatePresence initial={false}>
        {visible && (
          <motion.div
            key="info-float"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={SPRING_PANEL}
            className="info-float absolute top-16 right-5 bottom-5 z-20 w-[264px]"
          >
            <aside
              aria-label={t("文档信息浮窗")}
              className="anim-fade-in h-full w-full overflow-hidden rounded-[18px] border border-border/60 bg-card/80 shadow-lg backdrop-blur-2xl"
            >
              {children}
            </aside>
            <button
              type="button"
              aria-label={t("收起信息浮窗")}
              aria-expanded={true}
              onClick={onToggle}
              className="absolute top-1/2 -left-3.5 z-30 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-border/70 bg-card/75 text-muted-foreground shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      {!visible && (
        <button
          type="button"
          aria-label={t("展开信息浮窗")}
          aria-expanded={false}
          onClick={onToggle}
          className={cn(
            "absolute top-1/2 right-2 z-20 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-border/70 bg-card/75 text-muted-foreground shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <ChevronLeft className="size-3.5" />
        </button>
      )}
    </>
  );
}
