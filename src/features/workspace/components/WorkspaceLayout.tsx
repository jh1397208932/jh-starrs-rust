import { AnimatePresence, motion } from "motion/react";
import { TRANSITION_VIEW } from "@/lib/motion";
import { MOCK_RELATED } from "@/mocks/workspace";
import type { WorkspaceMainController } from "../hooks/useWorkspaceMainController";
import { InfoFloat } from "./InfoFloat";
import { InfoPanel } from "./InfoPanel";
import { Sidebar } from "./Sidebar";
import { SidebarColumn } from "./SidebarColumn";
import { TabContentView } from "./TabContentView";
import { WindowBar } from "./WindowBar";

export interface WorkspaceLayoutProps {
  controller: WorkspaceMainController;
}

/** 主界面布局：左列侧栏 + 右列单行顶栏/内容/信息浮窗（原窗口栏与文档工具栏已并为一行）。 */
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
    onDialogChange,
    onOpenExistingWorkspace,
    showToast,
    showError,
    showMockToast,
    requestNodeCreate,
    createDoc,
    createNote,
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
          onMockAction={(label) => showToast(`${label}：本阶段未实现`)}
          onShowStarred={tabSession.showStarred}
          onCreateNote={createNote}
          onCreateDoc={createDoc}
          onOpenNode={tabSession.openNode}
          onCreateRootNode={() => requestNodeCreate(null)}
          onCreateChildNode={(parent) => requestNodeCreate(parent)}
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
          onOpenSettings={() => onDialogChange({ type: "settings" })}
          kind={activeTab?.kind ?? "doc"}
          title={activeTab?.title ?? ""}
          kbName={activeKbName}
          starred={activeNode?.starred ?? false}
          infoOpen={infoVisible}
          onToggleStar={toggleStar}
          onToggleInfo={() => setInfoOpen((value) => !value)}
          onShare={() => onDialogChange({ type: "share" })}
          onPrint={() => showToast("已触发打印")}
          onOpenKb={() => onDialogChange({ type: "kbManage" })}
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
                  onOpenNode={tabSession.openNode}
                  onCreateDoc={createDoc}
                  onMockAction={showMockToast}
                  onDocumentSaved={store.applyDocumentSaved}
                  onError={showError}
                />
              </motion.div>
            </AnimatePresence>

            <InfoFloat visible={infoVisible} onToggle={() => setInfoOpen((value) => !value)}>
              <InfoPanel
                node={activeNode}
                kb={store.currentKb}
                workspacePath={currentWorkspace.path}
                related={MOCK_RELATED}
                onBackToInfo={() => setInfoOpen(false)}
              />
            </InfoFloat>
          </div>
        </main>
      </div>
    </div>
  );
}
