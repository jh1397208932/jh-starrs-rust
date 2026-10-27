import type {
  MindmapBackground,
  MindmapBranchColoring,
  MindmapEdgeStyle,
  MindmapExportFormat,
  MindmapSaveStatus,
  MindmapSheet,
  MindmapStructure,
  MindmapTheme,
} from "@/types/mindmap";
import { MindmapPageBar } from "./MindmapPageBar";

export interface MindmapPageBarContainerProps {
  kbName: string | null;
  title: string;
  status: MindmapSaveStatus;
  sheet: MindmapSheet;
  outlineOpen: boolean;
  exporting: MindmapExportFormat | null;
  onOpenKb: () => void;
  onRetry: () => void;
  onReload: () => void;
  onSearch: () => void;
  onToggleOutline: () => void;
  /** 页面级设置（结构/主题/配色/连线/背景/编号）统一写回 */
  onSheetChange: (patch: Partial<MindmapSheet>) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetLayout: () => void;
  onExport: (format: MindmapExportFormat) => void;
}

/** 页头装配：把画布设置收成一个 patch 回调，避免调用方重复展开 sheet 字段。 */
export function MindmapPageBarContainer({
  kbName,
  title,
  status,
  sheet,
  outlineOpen,
  exporting,
  onOpenKb,
  onRetry,
  onReload,
  onSearch,
  onToggleOutline,
  onSheetChange,
  onExpandAll,
  onCollapseAll,
  onResetLayout,
  onExport,
}: MindmapPageBarContainerProps) {
  return (
    <MindmapPageBar
      kbName={kbName}
      title={title}
      status={status}
      structure={sheet.structure}
      theme={sheet.theme}
      coloring={sheet.branchColoring ?? "theme"}
      edgeStyle={sheet.edgeStyle ?? "curve"}
      background={sheet.background ?? "dots"}
      showNumbers={sheet.showNumbers ?? false}
      outlineOpen={outlineOpen}
      exporting={exporting}
      onOpenKb={onOpenKb}
      onRetry={onRetry}
      onReload={onReload}
      onSearch={onSearch}
      onStructure={(structure: MindmapStructure) => onSheetChange({ structure })}
      onTheme={(theme: MindmapTheme) => onSheetChange({ theme })}
      onColoring={(coloring: MindmapBranchColoring) => onSheetChange({ branchColoring: coloring })}
      onEdgeStyle={(edgeStyle: MindmapEdgeStyle) => onSheetChange({ edgeStyle })}
      onBackground={(background: MindmapBackground) => onSheetChange({ background })}
      onToggleNumbers={() => onSheetChange({ showNumbers: !(sheet.showNumbers ?? false) })}
      onExpandAll={onExpandAll}
      onCollapseAll={onCollapseAll}
      onResetLayout={onResetLayout}
      onToggleOutline={onToggleOutline}
      onExport={onExport}
    />
  );
}
