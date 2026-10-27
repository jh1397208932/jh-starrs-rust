import { lazy, Suspense } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";
import { useMindmapCommands } from "../hooks/useMindmapCommands";
import { useMindmapExport } from "../hooks/useMindmapExport";
import { useMindmapGroupActions } from "../hooks/useMindmapGroupActions";
import { useMindmapKeymap } from "../hooks/useMindmapKeymap";
import { useMindmapViewState } from "../hooks/useMindmapViewState";
import { uploadTopicImage } from "../utils/topicImage";
import {
  attachFreeTopic,
  clearTopicPositions,
  expandAncestors,
  parentIdOf,
  reorderSibling,
  setAllCollapsed,
  setTopicPos,
} from "../utils/tree";
import { MindmapLoadShell } from "./MindmapLoadShell";
import { MindmapOutlinePanel } from "./MindmapOutlinePanel";
import { MindmapPageBarContainer } from "./MindmapPageBarContainer";
import { MindmapSearch } from "./MindmapSidePanels";
import { MindmapSidePanelsHost } from "./MindmapSidePanelsHost";
import { MindmapToolbar } from "./MindmapToolbar";
import "../mindmap.css";

const MindmapCanvas = lazy(() =>
  import("./MindmapCanvas").then((module) => ({ default: module.MindmapCanvas })),
);

interface MindmapViewProps {
  nodeId: string;
  title: string;
  kbName: string | null;
  onSaved: (updatedAt: number) => void;
  onError: (message: string) => void;
  onOpenKb: () => void;
  onExported?: (message: string) => void;
}

/** 思维导图节点页：组合页头、React Flow 画布、工具栏与右侧面板。 */
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
    selectedRelationshipId,
    setSelectedRelationshipId,
    selectedFrameId,
    setSelectedFrameId,
    editingId,
    setEditingId,
    searchOpen,
    setSearchOpen,
    outlineOpen,
    setOutlineOpen,
    search,
    setSearch,
    focusTarget,
    focusTopic,
    history,
    persistence,
    images,
    layout,
    commit,
    selectedTopic,
    selectedRelationship,
    selectedFrame,
    selectedFrameColor,
    groupSelection,
    results,
    clearSelection,
    onCommitText,
    onMoveUnder,
    onToggleCollapsed,
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
      <div className="mindmap-workspace">
        <Suspense fallback={<EmptyState glyph="✦" title={t("画布加载中…")} />}>
          <MindmapCanvas
            nodeId={nodeId}
            content={history.content}
            layout={layout}
            selectedId={selectedId}
            selectedFrameId={selectedFrameId}
            selectedRelationshipId={selectedRelationshipId}
            editingId={editingId}
            images={images}
            focusTarget={focusTarget}
            initialViewport={persistence.initial.viewport}
            onSelectionChange={(id, additive) => {
              clearSelection();
              setSelectedId(id);
              if (!id) {
                setSelectionSet([]);
                return;
              }
              setSelectionSet((current) =>
                additive ? (current.includes(id) ? current : [...current, id]) : [id],
              );
            }}
            onRelationshipSelect={(id) => {
              setSelectedId(null);
              setSelectedFrameId(null);
              setSelectedRelationshipId(id);
            }}
            onFrameSelect={(id) => {
              setSelectedId(null);
              setSelectedRelationshipId(null);
              setSelectedFrameId(id);
            }}
            onStartEdit={setEditingId}
            onCommitText={onCommitText}
            onToggleCollapsed={onToggleCollapsed}
            onMoveUnder={onMoveUnder}
            onSetPosition={(id, pos) => commit(setTopicPos(history.content, id, pos))}
            onReorder={(id, index) => commit(reorderSibling(history.content, id, index))}
            onFreeAttach={(freeId, targetId) => commit(attachFreeTopic(history.content, freeId, targetId))}
            onViewportChange={persistence.onViewportChange}
          />
        </Suspense>
        <MindmapToolbar
          selectedId={selectedId}
          rootId={history.content.sheet.root.id}
          collapsed={Boolean(selectedTopic?.collapsed)}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          groupSize={groupSelection.length}
          onAddChild={() => handlers["mindmap.addChild"]()}
          onAddSibling={() => handlers["mindmap.addSibling"]()}
          onToggle={() => handlers["mindmap.toggle"]()}
          onUndo={() => handlers["mindmap.undo"]()}
          onRedo={() => handlers["mindmap.redo"]()}
          onDelete={() => handlers["mindmap.delete"]()}
          onAddBoundary={addBoundaryForSelection}
          onAddSummary={addSummaryForSelection}
          onAddRelation={addRelationForSelection}
          onAddFreeTopic={addFreeTopicAtCanvas}
        />
        <MindmapSidePanelsHost
          content={history.content}
          relationship={selectedRelationship}
          frame={selectedFrame}
          frameColor={selectedFrameColor}
          topic={selectedTopic}
          commit={commit}
          clearSelection={clearSelection}
          onUploadImage={(file) => {
            if (!selectedTopic) return;
            void uploadTopicImage({
              nodeId,
              topicId: selectedTopic.id,
              file,
              images,
              content: history.content,
              commit,
              onError,
            });
          }}
        />
        {outlineOpen ? (
          <MindmapOutlinePanel
            content={history.content}
            selectedId={selectedId}
            onClose={() => setOutlineOpen(false)}
            onSelectionChange={(id) => {
              clearSelection();
              setSelectedId(id);
              setSelectionSet([id]);
            }}
            focusTopic={focusTopic}
            commit={commit}
            setSelectedId={setSelectedId}
            setEditingId={setEditingId}
          />
        ) : null}
        {searchOpen ? (
          <MindmapSearch
            value={search}
            results={results}
            onChange={setSearch}
            onClose={() => setSearchOpen(false)}
            onPick={(id) => {
              commit(expandAncestors(history.content, id));
              setSelectedId(id);
              setSelectionSet([id]);
              focusTopic(id);
              setSearchOpen(false);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
