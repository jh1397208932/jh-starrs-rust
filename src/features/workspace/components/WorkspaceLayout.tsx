import { ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo } from "react";
import { SearchPalette } from "@/features/search/components/SearchPalette";
import { useI18n } from "@/lib/i18n";
import { TRANSITION_VIEW } from "@/lib/motion";
import type { NodeItem } from "@/types/notebook";
import type { useWorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { registerNodeOpener } from "../openNode";
import { InfoPanel } from "./InfoPanel";
import { LibraryManagerDialog } from "./LibraryManagerDialog";
import { OutlinePanel } from "./OutlinePanel";
import { Sidebar } from "./Sidebar";
import { SidebarColumn } from "./SidebarColumn";
import { SidePanelFloat } from "./SidePanelFloat";
import { TabContentView } from "./TabContentView";
import { WindowBar } from "./WindowBar";

export interface WorkspaceLayoutProps {
  controller: ReturnType<typeof useWorkspaceMainController>;
}

/** 主界面布局：左列侧栏 + 右列顶栏（标签/搜索）、正文与信息浮窗；文档操作随正文页头下沉。 */
export function WorkspaceLayout({ controller }: WorkspaceLayoutProps) {
  const { t } = useI18n();
  const {
    store,
    activeTab,
    activeNode,
    activeKbName,
    infoVisible,
    outlineVisible,
    toggleInfo,
    toggleOutline,
    sidebarOpen,
    moreMenuOpen,
    setMoreMenuOpen,
    searchOpen,
    setSearchOpen,
    searchMode,
    openSearch,
    openSearchHit,
    dialog,
    onDialogChange,
    onOpenExistingWorkspace,
    showToast,
    showError,
    showMockToast,
    requestNodeCreate,
    createDoc,
    createNote,
    uploadAttachmentsToTree,
    handleSwitchWorkspace,
    handleSwitchKb,
    toggleStar,
    printActiveDocument,
    tabSession,
    actions,
  } = controller;
  // 稳定引用：弹窗开启器与子组件回调统一收敛，保证 memo(Sidebar/TabContentView) 生效（2026-10-27 性能任务 B2）。
  // 钩子必须位于 early return 之前，保证 hook 顺序稳定。
  const openDialog = useMemo(
    () => ({
      createWorkspace: () => onDialogChange({ type: "createWorkspace" }),
      newKb: () => onDialogChange({ type: "newKb" }),
      kbManage: () => onDialogChange({ type: "kbManage" }),
      wsManage: () => onDialogChange({ type: "wsManage" }),
      settings: () => onDialogChange({ type: "settings" }),
      exportKb: () => onDialogChange({ type: "exportKb" }),
      importRoot: () => onDialogChange({ type: "import", parentId: null }),
      library: () => onDialogChange({ type: "library" }),
      backup: () => onDialogChange({ type: "backup" }),
      templates: () => onDialogChange({ type: "templates" }),
      nodeTrash: () => onDialogChange({ type: "nodeTrash" }),
      share: () => onDialogChange({ type: "share" }),
    }),
    [onDialogChange],
  );
  const createChildNode = useCallback((parent: NodeItem) => requestNodeCreate(parent), [requestNodeCreate]);
  const printCurrent = useCallback(() => void printActiveDocument(), [printActiveDocument]);
  const showBoardExported = useCallback((message: string) => showToast(message, "primary"), [showToast]);
  // 这些回调直接传给 memo(Sidebar/WindowBar)；内联函数会击穿 memo，让整棵树/标签栏跟着重渲染。
  const importToFolder = useCallback(
    (parent: NodeItem) => onDialogChange({ type: "import", parentId: parent.id }),
    [onDialogChange],
  );
  const openSearchEverywhere = useCallback(() => openSearch("search"), [openSearch]);
  const showWindowFallback = useCallback((label: string) => showMockToast(label), [showMockToast]);
  const openInfoNode = useCallback(
    (id: string) => {
      const target = store.nodes.find((item) => item.id === id);
      if (target) tabSession.openNode(target);
    },
    [store.nodes, tabSession.openNode],
  );
  // 文档内嵌块的“打开源内容”走单槽通道，避免把回调穿透到编辑器扩展。
  useEffect(
    () =>
      registerNodeOpener((nodeId) => {
        const target = store.nodes.find((item) => item.id === nodeId);
        if (target) tabSession.openNode(target);
      }),
    [store.nodes, tabSession.openNode],
  );
  const currentWorkspace = store.currentWorkspace;
  const isDocTab = activeTab?.kind === "doc";
  if (!currentWorkspace) return null;

  return (
    <div className="app-shell flex h-full">
      <SidebarColumn open={sidebarOpen}>
        <Sidebar
          workspaces={store.workspaces}
          kbs={store.kbs}
          currentWorkspace={currentWorkspace}
          currentKb={store.currentKb}
          tree={store.tree}
          nodes={store.nodes}
          selectedNodeId={activeTab?.nodeId ?? null}
          moreMenuOpen={moreMenuOpen}
          onMoreMenuOpenChange={setMoreMenuOpen}
          onSwitchWorkspace={handleSwitchWorkspace}
          onSwitchKb={handleSwitchKb}
          onCreateWorkspace={openDialog.createWorkspace}
          onOpenWorkspace={onOpenExistingWorkspace}
          onCreateKb={openDialog.newKb}
          onManageKbs={openDialog.kbManage}
          onManageWorkspaces={openDialog.wsManage}
          onOpenSettings={openDialog.settings}
          onAllExport={openDialog.exportKb}
          onImport={openDialog.importRoot}
          onImportToFolder={importToFolder}
          onOpenLibrary={openDialog.library}
          onBackup={openDialog.backup}
          onTemplates={openDialog.templates}
          onNodeTrash={openDialog.nodeTrash}
          onShowStarred={tabSession.showStarred}
          onCreateNote={createNote}
          onCreateDoc={createDoc}
          onOpenNode={tabSession.openNode}
          onCreateRootNode={createDoc}
          onCreateChildNode={createChildNode}
          onUploadAttachment={uploadAttachmentsToTree}
          onRenameNode={controller.setNodeRename}
          onDeleteNode={controller.setNodeDelete}
          onMoveNode={actions.moveNode}
          onError={showError}
        />
      </SidebarColumn>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WindowBar
          tabs={tabSession.tabs}
          activeTabId={tabSession.activeTabId}
          onSelect={tabSession.setActiveTabId}
          onClose={tabSession.closeTab}
          onSearch={openSearchEverywhere}
          trafficInset={!sidebarOpen}
          onWindowFallback={showWindowFallback}
        />
        <main className="app-sheet m-2 mt-1 flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* 标签切换 = 并行交叉淡入：新视图立即挂载（absolute 叠放），旧视图 140ms 淡出。
                mode="wait" 的串行结构会让重型编辑器挂载被推迟一整个退场时长，切换发涩（2026-10-27 性能任务 B3）。 */}
            <AnimatePresence initial={false}>
              <motion.div
                key={activeTab?.id ?? "empty"}
                className="absolute inset-0"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={TRANSITION_VIEW}
              >
                <TabContentView
                  activeTab={activeTab}
                  activeNode={activeNode}
                  nodes={store.nodes}
                  starredNodes={store.starredNodes}
                  kbName={activeKbName}
                  starred={activeNode?.starred ?? false}
                  infoOpen={infoVisible}
                  outlineOpen={outlineVisible}
                  onToggleStar={toggleStar}
                  onToggleInfo={toggleInfo}
                  onToggleOutline={toggleOutline}
                  onShare={openDialog.share}
                  onPrint={printCurrent}
                  onOpenKb={openDialog.kbManage}
                  onOpenNode={tabSession.openNode}
                  onCreateDoc={createDoc}
                  onDocumentSaved={store.applyDocumentSaved}
                  onBoardSaved={store.applyBoardSaved}
                  onBoardExported={showBoardExported}
                  onError={showError}
                />
              </motion.div>
            </AnimatePresence>

            {/* 右侧浮窗：信息 / 大纲互斥；展开钮与浮窗仅文档标签出现 */}
            {isDocTab && !infoVisible && !outlineVisible && (
              <button
                type="button"
                aria-label={t("展开大纲面板")}
                onClick={toggleOutline}
                className="absolute top-1/2 right-2 z-20 grid size-7 -translate-y-1/2 place-items-center rounded-full border border-border/70 bg-card/75 text-muted-foreground shadow-sm backdrop-blur-md transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronLeft className="size-3.5" />
              </button>
            )}
            <SidePanelFloat visible={infoVisible} onCollapse={toggleInfo} panelTitle={t("信息面板")}>
              <InfoPanel
                node={activeNode}
                kb={store.currentKb}
                onBackToInfo={toggleInfo}
                onOpenNode={openInfoNode}
              />
            </SidePanelFloat>
            <SidePanelFloat visible={outlineVisible} onCollapse={toggleOutline} panelTitle={t("大纲面板")}>
              <OutlinePanel />
            </SidePanelFloat>
            <LibraryManagerDialog
              open={dialog?.type === "library"}
              onOpenChange={(open) => onDialogChange(open ? { type: "library" } : null)}
              onError={showError}
            />
            <SearchPalette
              open={searchOpen}
              mode={searchMode}
              knowledgeBaseId={store.currentKb?.id ?? null}
              onOpenChange={setSearchOpen}
              onSelect={openSearchHit}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
