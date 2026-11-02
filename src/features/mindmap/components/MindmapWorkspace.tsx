/**
 * 画布工作区：画布、底部工具栏、右侧面板、左侧大纲与搜索。
 *
 * 页面壳只保留页头与加载/错误状态；这里集中画布相关的布局与交互接线。
 */

import { lazy, Suspense } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useI18n } from "@/lib/i18n";
import type { MindmapShortcutHandlers } from "../hooks/useMindmapKeymap";
import type { MindmapViewState } from "../hooks/useMindmapViewState";
import { uploadTopicImage } from "../utils/topicImage";
import { attachFreeTopic, expandAncestors, reorderSibling, setTopicPos } from "../utils/tree";
import { MindmapOutlinePanel } from "./MindmapOutlinePanel";
import { MindmapSearch } from "./MindmapSidePanels";
import { MindmapSidePanelsHost } from "./MindmapSidePanelsHost";
import { MindmapToolbar } from "./MindmapToolbar";

const MindmapCanvas = lazy(() =>
  import("./MindmapCanvas").then((module) => ({ default: module.MindmapCanvas })),
);

export interface MindmapWorkspaceProps {
  nodeId: string;
  state: MindmapViewState;
  onError: (message: string) => void;
  handlers: MindmapShortcutHandlers;
  groupActions: {
    addBoundaryForSelection: () => void;
    addSummaryForSelection: () => void;
    addRelationForSelection: () => void;
    addFreeTopicAtCanvas: () => void;
  };
}

export function MindmapWorkspace({ nodeId, state, onError, handlers, groupActions }: MindmapWorkspaceProps) {
  const { t } = useI18n();
  const {
    selectedId,
    setSelectedId,
    setSelectionSet,
    selectedRelationshipId,
    setSelectedRelationshipId,
    selectedFrameId,
    setSelectedFrameId,
    inspectorOpen,
    setInspectorOpen,
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

  return (
    <div
      className="mindmap-workspace"
      data-theme={history.content.sheet.theme}
      data-coloring={history.content.sheet.branchColoring ?? "theme"}
    >
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
          initialViewport={persistence.initial?.viewport ?? null}
          onSelectionChange={(id, additive) => {
            clearSelection();
            setSelectedId(id);
            // 选中主题即切换详情面板内容；面板本身是否展开仍由用户控制（未打开时保持关闭）。
            if (!id) setInspectorOpen(false);
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
            setInspectorOpen(false);
            setSelectedRelationshipId(id);
          }}
          onFrameSelect={(id) => {
            setSelectedId(null);
            setInspectorOpen(false);
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
        onAddBoundary={groupActions.addBoundaryForSelection}
        onAddSummary={groupActions.addSummaryForSelection}
        onAddRelation={groupActions.addRelationForSelection}
        onAddFreeTopic={groupActions.addFreeTopicAtCanvas}
        onOpenInspector={() => setInspectorOpen(true)}
      />
      <MindmapSidePanelsHost
        content={history.content}
        relationship={selectedRelationship}
        frame={selectedFrame}
        frameColor={selectedFrameColor}
        topic={inspectorOpen ? selectedTopic : null}
        commit={commit}
        clearSelection={() => {
          setInspectorOpen(false);
          clearSelection();
        }}
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
            // 在大纲里点行就是为了看细节：直接把右侧详情面板打开，不再要求再点一次工具栏。
            setInspectorOpen(true);
          }}
          focusTopic={focusTopic}
          commit={commit}
          setSelectedId={setSelectedId}
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
  );
}
