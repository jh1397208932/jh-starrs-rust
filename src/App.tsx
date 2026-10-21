import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { AppToast } from "@/components/common/AppToast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShareExportDialog } from "@/features/editor/components/ShareExportDialog";
import { SettingsDialog } from "@/features/settings/components/SettingsDialog";
import { InfoFloat } from "@/features/workspace/components/InfoFloat";
import { InfoPanel } from "@/features/workspace/components/InfoPanel";
import { Sidebar } from "@/features/workspace/components/Sidebar";
import { SidebarColumn } from "@/features/workspace/components/SidebarColumn";
import { TabContentView } from "@/features/workspace/components/TabContentView";
import { Toolbar } from "@/features/workspace/components/Toolbar";
import { WindowBar } from "@/features/workspace/components/WindowBar";
import { type WorkspaceDialogKind, WorkspaceDialogs } from "@/features/workspace/components/WorkspaceDialogs";
import { useTabSession } from "@/features/workspace/hooks/useTabSession";
import { useWorkspaceDialogActions } from "@/features/workspace/hooks/useWorkspaceDialogActions";
import { useWorkspaceShortcuts } from "@/features/workspace/hooks/useWorkspaceShortcuts";
import { useWorkspaceStore } from "@/features/workspace/hooks/useWorkspaceStore";
import { findNode } from "@/features/workspace/utils/tree";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useToast } from "@/hooks/useToast";
import { TRANSITION_VIEW } from "@/lib/motion";
import { ThemeProvider } from "@/lib/theme";
import { MOCK_RELATED } from "@/mocks/workspace";

/** 全局弹窗状态机：同时只开一个（设置 / 工作区群 / 分享） */
type DialogState = null | { type: "settings" } | { type: "share" } | { type: WorkspaceDialogKind };

/** 工作区弹窗 kind 收窄：从全局 dialog 状态中取出属于工作区群的弹窗 */
function toWorkspaceDialog(dialog: DialogState): WorkspaceDialogKind | null {
  if (!dialog || dialog.type === "settings" || dialog.type === "share") return null;
  return dialog.type;
}

/**
 * 页面骨架组装层（AGENTS.md §3.4）：只做状态编排、布局组装与全局弹窗挂载，
 * 不承载业务规则——领域状态在 features/workspace/hooks，展示在各 feature 组件。
 */
function WorkspaceShell() {
  const store = useWorkspaceStore();
  const { tabs, activeTabId, activeTab, openNode, closeTab, showStarred, setActiveTabId } = useTabSession();
  const { toast, showToast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(() => window.innerWidth >= 1280);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const { workspaces, kbs, tree, currentWorkspace, currentKb, starredNodes } = store;
  const activeNode = activeTab?.nodeId ? findNode(tree, activeTab.nodeId) : null;
  /* 面包屑上级：文档所在知识库；未命名暂存跟随当前知识库；收藏列表等虚拟页无上级 */
  const activeKbName = activeNode
    ? (kbs.find((kb) => kb.id === activeNode.kbId)?.name ?? null)
    : activeTab?.kind === "starred"
      ? null
      : (currentKb?.name ?? null);
  /* 信息面板为文档独有：画板/表格/收藏标签下自动隐藏（状态保留，切回文档恢复） */
  const infoVisible = infoOpen && activeTab?.kind === "doc";

  const showMockToast = useCallback(
    (label: string, kbd?: string) =>
      showToast(`已触发 ${kbd ? `${kbd} ` : ""}${label}（mock）`, "primary", kbd),
    [showToast],
  );

  /** 新建文档：创建节点并打开标签页 */
  const createDoc = useCallback(
    (title: string) => openNode(store.createNode(title)),
    [openNode, store.createNode],
  );

  const toggleStar = useCallback(() => {
    if (!activeNode) {
      showToast("已收藏（mock）");
      return;
    }
    store.toggleStar(activeNode.id);
    showToast(activeNode.starred ? "已取消收藏" : "已收藏", "primary", "⌘D");
  }, [activeNode, showToast, store.toggleStar]);

  /* ---------- 全局快捷键（规则在 useWorkspaceShortcuts，挂载在 useKeyboardShortcuts） ---------- */
  useKeyboardShortcuts(
    useWorkspaceShortcuts({
      createDoc: () => createDoc("未命名文档"),
      closeActiveTab: () => {
        if (activeTab) {
          closeTab(activeTab.id);
          showToast("已自动保存，标签已关闭");
        }
      },
      toggleStar,
      toggleSidebar: () => setSidebarOpen((v) => !v),
      toggleMoreMenu: () => setMoreMenuOpen((v) => !v),
      openSettings: () => setDialog({ type: "settings" }),
      quickJump: () => showMockToast("快速跳转", "⌘K"),
      globalSearch: () => showMockToast("全局搜索", "⌘⇧F"),
      saveDoc: () => showToast("已保存当前文档", "primary", "⌘S"),
      presentBoard: () => showMockToast("放映当前画板", "⌘P"),
    }),
  );

  /* ---------- 弹窗动作编排（领域变更 + toast + 关窗的 glue，见 useWorkspaceDialogActions） ---------- */
  const dialogActions = useWorkspaceDialogActions(store, showToast, () => setDialog(null));

  return (
    <TooltipHost>
      <div className="flex h-full">
        {/* 左列：窗口拖拽带/红绿灯 · 商标 · 工作区 · 新建 · 树 · 更多 */}
        <SidebarColumn open={sidebarOpen}>
          <Sidebar
            workspaces={workspaces}
            kbs={kbs}
            tree={tree}
            moreMenuOpen={moreMenuOpen}
            onMoreMenuOpenChange={setMoreMenuOpen}
            onSwitchWorkspace={store.switchWorkspace}
            onSwitchKb={store.switchKb}
            onCreateWorkspace={() => setDialog({ type: "createWorkspace" })}
            onCreateKb={() => setDialog({ type: "newKb" })}
            onManageKbs={() => setDialog({ type: "kbManage" })}
            onManageWorkspaces={() => setDialog({ type: "wsManage" })}
            onOpenSettings={() => setDialog({ type: "settings" })}
            onMockAction={(label) => showToast(`${label}：本阶段未实现`)}
            onShowStarred={showStarred}
            onCreateNote={() => createDoc("小记")}
            onCreateDoc={() => createDoc("未命名文档")}
            onOpenNode={openNode}
          />
        </SidebarColumn>

        {/* 右列：窗口栏（tab 从分割线起）→ 文档工具栏（文档层）→ 内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <WindowBar
            tabs={tabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
            onNew={() => createDoc("未命名文档")}
            onSearch={() => showMockToast("全局搜索", "⌘⇧F")}
            onOpenSettings={() => setDialog({ type: "settings" })}
            trafficInset={!sidebarOpen}
            onWindowFallback={(label) => showMockToast(label)}
          />
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <Toolbar
              kind={activeTab?.kind ?? "doc"}
              title={activeTab?.title ?? ""}
              kbName={activeKbName}
              starred={activeNode?.starred ?? false}
              infoOpen={infoVisible}
              onToggleStar={toggleStar}
              onToggleInfo={() => setInfoOpen((v) => !v)}
              onShare={() => setDialog({ type: "share" })}
              onPrint={() => showToast("已触发打印")}
              onOpenKb={() => showMockToast("打开知识库")}
            />
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
                    starredNodes={starredNodes}
                    onOpenNode={openNode}
                    onCreateDoc={createDoc}
                    onMockAction={showMockToast}
                  />
                </motion.div>
              </AnimatePresence>

              {/* 信息浮窗：文档独有附加浮层，悬浮于内容右上；右滑弹簧出入场 + 骑缝把手 */}
              <InfoFloat visible={infoVisible} onToggle={() => setInfoOpen((v) => !v)}>
                <InfoPanel
                  node={activeNode}
                  kb={currentKb ?? null}
                  related={MOCK_RELATED}
                  onBackToInfo={() => setInfoOpen(false)}
                />
              </InfoFloat>
            </div>
          </main>
        </div>
      </div>

      {/* 全局弹窗：设置 / 分享导出归各自 feature，工作区群由 WorkspaceDialogs 收敛 */}
      <SettingsDialog
        open={dialog?.type === "settings"}
        onOpenChange={(open) => setDialog(open ? { type: "settings" } : null)}
        onMockAction={(label) => showToast(`${label}（mock）`)}
      />
      <ShareExportDialog
        open={dialog?.type === "share"}
        onOpenChange={(open) => setDialog(open ? { type: "share" } : null)}
        title={activeTab?.title ?? "未命名文档"}
        kbName={currentKb?.name ?? ""}
        wordCount={activeNode?.wordCount ?? 0}
        updatedAt={activeNode?.updatedAt ?? "刚刚"}
        onMockExport={() => showToast("已触发 ⌘E 导出（mock）", "primary", "⌘E")}
      />
      <WorkspaceDialogs
        open={toWorkspaceDialog(dialog)}
        onOpenChange={(kind) => setDialog(kind ? { type: kind } : null)}
        workspaces={workspaces}
        kbs={kbs}
        currentWorkspaceName={currentWorkspace?.name ?? ""}
        onCreateWorkspace={dialogActions.createWorkspace}
        onCreateKb={dialogActions.createKb}
        onDeleteKb={dialogActions.deleteKb}
        onDeleteWorkspace={dialogActions.deleteWorkspace}
        onDeleteCurrentDenied={dialogActions.deleteCurrentDenied}
        onSwitchWorkspace={store.switchWorkspace}
        onSwitchKb={store.switchKb}
        onMockAction={(label) => showToast(`${label}（mock）`)}
      />

      <AppToast toast={toast} />
    </TooltipHost>
  );
}

/** 全局 Tooltip 上下文 */
function TooltipHost({ children }: { children: React.ReactNode }) {
  return <TooltipProvider delayDuration={300}>{children}</TooltipProvider>;
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceShell />
    </ThemeProvider>
  );
}
