import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";
import { MindmapPageBar } from "./MindmapPageBar";

export interface MindmapLoadShellProps {
  kbName: string | null;
  title: string;
  mode: "loading" | "error";
  error?: string | null;
  onOpenKb: () => void;
  onRetry: () => void;
  onReload: () => void;
}

/** 加载/失败态的整页外壳：禁用全部页头动作，只保留返回与重试。 */
export function MindmapLoadShell({
  kbName,
  title,
  mode,
  error,
  onOpenKb,
  onRetry,
  onReload,
}: MindmapLoadShellProps) {
  const { t } = useI18n();
  return (
    <div className="mindmap-view">
      <MindmapPageBar
        kbName={kbName}
        title={title}
        status={mode === "error" ? "error" : "loading"}
        structure="balanced"
        theme="vivid"
        coloring="theme"
        edgeStyle="curve"
        background="dots"
        showNumbers={false}
        outlineOpen={false}
        exporting={null}
        errorText={t("加载失败 · 重试")}
        onOpenKb={onOpenKb}
        onRetry={onRetry}
        onReload={onReload}
        onSearch={() => undefined}
        onStructure={() => undefined}
        onTheme={() => undefined}
        onColoring={() => undefined}
        onEdgeStyle={() => undefined}
        onBackground={() => undefined}
        onToggleNumbers={() => undefined}
        onExpandAll={() => undefined}
        onCollapseAll={() => undefined}
        onResetLayout={() => undefined}
        onToggleOutline={() => undefined}
        onExport={() => undefined}
      />
      {mode === "error" ? (
        <EmptyState glyph="!" title={t("思维导图加载失败")} description={error ?? ""} />
      ) : (
        <EmptyState glyph="✦" title={t("思维导图加载中…")} />
      )}
    </div>
  );
}
