import { AnimatePresence, motion } from "motion/react";
import { TRANSITION_VIEW } from "@/lib/motion";
import { MOCK_RELATED } from "@/mocks/workspace";
import type { WorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { InfoFloat } from "./InfoFloat";
import { InfoPanel } from "./InfoPanel";
import { LibraryManagerDialog } from "./LibraryManagerDialog";
import { Sidebar } from "./Sidebar";
import { SidebarColumn } from "./SidebarColumn";
import { TabContentView } from "./TabContentView";
import { WindowBar } from "./WindowBar";

export interface WorkspaceLayoutProps {
  controller: WorkspaceMainController;
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
    tabSession,
    actions,
  } = controller;
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
          onCreateWorkspace={() => onDialogChange({ type: "createWorkspace" })}
          onOpenWorkspace={onOpenExistingWorkspace}
          onCreateKb={() => onDialogChange({ type: "newKb" })}
          onManageKbs={() => onDialogChange({ type: "kbManage" })}
          onManageWorkspaces={() => onDialogChange({ type: "wsManage" })}
          onOpenSettings={() => onDialogChange({ type: "settings" })}
          onAllExport={() => onDialogChange({ type: "exportKb" })}
          onImport={() => onDialogChange({ type: "import", parentId: null })}
          onImportToFolder={(parent) => onDialogChange({ type: "import", parentId: parent.id })}
          onOpenLibrary={() => onDialogChange({ type: "library" })}
          onMockAction={showMockToast}
          onShowStarred={tabSession.showStarred}
          onCreateNote={createNote}
          onCreateDoc={createDoc}
          onOpenNode={tabSession.openNode}
          onCreateRootNode={() => requestNodeCreate(null)}
          onCreateChildNode={(parent) => requestNodeCreate(parent)}
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
          onSearch={() => showMockToast("全局搜索", "⌘⇧F")}
          trafficInset={!sidebarOpen}
          onWindowFallback={(label) => showMockToast(label)}
        />
        <main className="app-sheet m-2 mt-1 flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab?.id ?? "empty"}
                className="h-full"
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
                  onToggleInfo={() => setInfoOpen((value) => !value)}
                  onShare={() => onDialogChange({ type: "share" })}
                  onPrint={() => showMockToast("打印")}
                  onOpenKb={() => onDialogChange({ type: "kbManage" })}
                  onOpenNode={tabSession.openNode}
                  onCreateDoc={createDoc}
                  onMockAction={showMockToast}
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
                related={MOCK_RELATED}
                onBackToInfo={() => setInfoOpen(false)}
              />
            </InfoFloat>
            <LibraryManagerDialog
              open={dialog?.type === "library"}
              onOpenChange={(open) => onDialogChange(open ? { type: "library" } : null)}
              onError={showError}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
