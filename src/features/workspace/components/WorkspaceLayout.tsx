import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo } from "react";
import { SearchPalette } from "@/features/search/components/SearchPalette";
import { TRANSITION_VIEW } from "@/lib/motion";
import type { NodeItem } from "@/types/notebook";
import type { useWorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { InfoFloat } from "./InfoFloat";
import { InfoPanel } from "./InfoPanel";
import { LibraryManagerDialog } from "./LibraryManagerDialog";
import { Sidebar } from "./Sidebar";
import { SidebarColumn } from "./SidebarColumn";
import { TabContentView } from "./TabContentView";
import { WindowBar } from "./WindowBar";

export interface WorkspaceLayoutProps {
  controller: ReturnType<typeof useWorkspaceMainController>;
}

/** 主界面布局：左列侧栏 + 右列顶栏（标签/搜索）、正文与信息浮窗；文档操作随正文页头下沉。 */
export function WorkspaceLayout({ controller }: WorkspaceLayoutProps) {
  const {
    store,
    activeTab,
    activeNode,
    activeKbName,
    infoVisible,
    setInfoOpen,
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
    importMindmapFiles,
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
  const toggleInfo = useCallback(() => setInfoOpen((value) => !value), [setInfoOpen]);
  const printCurrent = useCallback(() => void printActiveDocument(), [printActiveDocument]);
  const currentWorkspace = store.currentWorkspace;
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
          onImportMindmap={importMindmapFiles}
          onImportToFolder={(parent) => onDialogChange({ type: "import", parentId: parent.id })}
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
          onSearch={() => openSearch("search")}
          trafficInset={!sidebarOpen}
          onWindowFallback={(label) => showMockToast(label)}
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
                  starredNodes={store.starredNodes}
                  kbName={activeKbName}
                  starred={activeNode?.starred ?? false}
                  infoOpen={infoVisible}
                  onToggleStar={toggleStar}
                  onToggleInfo={toggleInfo}
                  onShare={openDialog.share}
                  onPrint={printCurrent}
                  onOpenKb={openDialog.kbManage}
                  onOpenNode={tabSession.openNode}
                  onCreateDoc={createDoc}
                  onDocumentSaved={store.applyDocumentSaved}
                  onBoardSaved={store.applyBoardSaved}
                  onBoardExported={(message) => showToast(message, "primary")}
                  onError={showError}
                />
              </motion.div>
            </AnimatePresence>

            <InfoFloat visible={infoVisible} onToggle={() => setInfoOpen((value) => !value)}>
              <InfoPanel
                node={activeNode}
                kb={store.currentKb}
                onBackToInfo={() => setInfoOpen(false)}
                onOpenNode={(id) => {
                  const target = store.nodes.find((item) => item.id === id);
                  if (target) tabSession.openNode(target);
                }}
              />
            </InfoFloat>
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
