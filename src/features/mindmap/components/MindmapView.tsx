import { useI18n } from "@/lib/i18n";
import { useMindmapCommands } from "../hooks/useMindmapCommands";
import { useMindmapExport } from "../hooks/useMindmapExport";
import { useMindmapGroupActions } from "../hooks/useMindmapGroupActions";
import { useMindmapKeymap } from "../hooks/useMindmapKeymap";
import { useMindmapViewState } from "../hooks/useMindmapViewState";
import { clearTopicPositions, parentIdOf, setAllCollapsed } from "../utils/tree";
import { MindmapLoadShell } from "./MindmapLoadShell";
import { MindmapPageBarContainer } from "./MindmapPageBarContainer";
import { MindmapWorkspace } from "./MindmapWorkspace";
import "../mindmap.css";

interface MindmapViewProps {
  nodeId: string;
  title: string;
  kbName: string | null;
  onSaved: (updatedAt: number) => void;
  onError: (message: string) => void;
  onOpenKb: () => void;
  onExported?: (message: string) => void;
}

/** 思维导图节点页：页头、加载状态与工作区装配。 */
export function MindmapView({
  nodeId,
  title,
  kbName,
  onSaved,
  onError,
  onOpenKb,
  onExported,
}: MindmapViewProps) {
  const { t } = useI18n();
  const state = useMindmapViewState({ nodeId, onSaved, onError });
  const {
    selectedId,
    setSelectedId,
    setSelectionSet,
    setEditingId,
    setSearchOpen,
    outlineOpen,
    setOutlineOpen,
    focusTopic,
    history,
    persistence,
    images,
    layout,
    commit,
    groupSelection,
    clearSelection,
  } = state;

  const exportHandler = useMindmapExport({
    nodeId,
    title,
    content: history.content,
    images,
    flush: persistence.flush,
    onError,
    onExported: (message) => onExported?.(message),
  });

  const { handlers } = useMindmapCommands({
    content: history.content,
    rootId: history.content.sheet.root.id,
    selectedId,
    layoutNodes: layout.nodes,
    commit,
    historyUndo: history.undo,
    historyRedo: history.redo,
    flush: persistence.flush,
    focusTopic,
    clearSelection,
    setSelectedId,
    setSelectionSet,
    setEditingId,
    setSearchOpen,
  });
  useMindmapKeymap(persistence.status !== "loading", handlers);

  const { addBoundaryForSelection, addSummaryForSelection, addRelationForSelection, addFreeTopicAtCanvas } =
    useMindmapGroupActions({
      content: history.content,
      commit,
      selectedId,
      groupSelection,
      parentIdOf: (childId) => parentIdOf(history.content, childId),
      labelSummary: t("概要"),
      labelFloating: t("自由主题"),
      clearSelection,
      setSelectedId,
      setSelectionSet,
      setEditingId,
    });

  if (persistence.loadError) {
    return (
      <MindmapLoadShell
        kbName={kbName}
        title={title}
        mode="error"
        error={persistence.loadError}
        onOpenKb={onOpenKb}
        onRetry={persistence.reload}
        onReload={persistence.reload}
      />
    );
  }
  if (!persistence.initial) {
    return (
      <MindmapLoadShell
        kbName={kbName}
        title={title}
        mode="loading"
        onOpenKb={onOpenKb}
        onRetry={persistence.reload}
        onReload={persistence.reload}
      />
    );
  }

  return (
    <div className="mindmap-view">
      <MindmapPageBarContainer
        kbName={kbName}
        title={title}
        status={persistence.status}
        sheet={history.content.sheet}
        outlineOpen={outlineOpen}
        exporting={exportHandler.exporting}
        onOpenKb={onOpenKb}
        onRetry={persistence.retry}
        onReload={persistence.reload}
        onSearch={() => setSearchOpen(true)}
        onToggleOutline={() => setOutlineOpen((current) => !current)}
        onSheetChange={(patch) =>
          commit({ ...history.content, sheet: { ...history.content.sheet, ...patch } })
        }
        onExpandAll={() => commit(setAllCollapsed(history.content, false))}
        onCollapseAll={() => commit(setAllCollapsed(history.content, true))}
        onResetLayout={() => commit(clearTopicPositions(history.content))}
        onExport={(format) => void exportHandler.exportMindmapFile(format)}
      />
      <MindmapWorkspace
        nodeId={nodeId}
        state={state}
        onError={onError}
        handlers={handlers}
        groupActions={{
          addBoundaryForSelection,
          addSummaryForSelection,
          addRelationForSelection,
          addFreeTopicAtCanvas,
        }}
      />
    </div>
  );
}
