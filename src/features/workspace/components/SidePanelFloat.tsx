import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import { SPRING_PANEL } from "@/lib/motion";

export interface SidePanelFloatProps {
  /** 是否展开（信息 / 大纲互斥，由调用方状态机保证） */
  visible: boolean;
  /** 左缘骑缝把手：收起回调 */
  onCollapse: () => void;
  /** 面板名，用于无障碍标签（如「信息面板」「大纲面板」） */
  panelTitle: string;
  /** 面板内容（InfoPanel / OutlinePanel） */
  children: ReactNode;
}

/**
 * 右侧浮窗容器（信息 / 大纲共用）：悬浮于内容区右上（absolute，不占主布局）。
 * 展开 = 右滑弹簧入场 + 左缘骑缝把手（收起）；收起态的展开钮由调用方渲染（文档标签独占）。
 * 面板本体不透明化（2026-10-27 模糊预算）：弹簧位移走纯合成。
 */
export function SidePanelFloat({ visible, onCollapse, panelTitle, children }: SidePanelFloatProps) {
  const { t } = useI18n();
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key={panelTitle}
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={SPRING_PANEL}
          className="info-float absolute top-16 right-5 bottom-5 z-20 w-[264px]"
        >
          <aside
            aria-label={panelTitle}
            className="h-full w-full overflow-hidden rounded-[18px] border border-border/60 bg-card shadow-lg"
          >
            {children}
          </aside>
          <button
            type="button"
            aria-label={t("收起{panel}", { panel: panelTitle })}
            aria-expanded={true}
            onClick={onCollapse}
            className="absolute top-1/2 -left-3.5 z-30 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-border/70 bg-card/75 text-muted-foreground shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
