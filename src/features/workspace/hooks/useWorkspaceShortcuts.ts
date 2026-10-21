/**
 * 快捷键动作集：由 App 组装层注入具体实现（状态操作 + toast + 弹窗开关）。
 * 未实现功能统一走 mock toast（quickJump / globalSearch / presentBoard）。
 */
export interface ShortcutActions {
  createDoc: () => void;
  closeActiveTab: () => void;
  toggleStar: () => void;
  toggleSidebar: () => void;
  toggleMoreMenu: () => void;
  openSettings: () => void;
  quickJump: () => void;
  globalSearch: () => void;
  saveDoc: () => void;
  presentBoard: () => void;
}

/**
 * 工作区全局快捷键规则（⌘/Ctrl 组合，与设置-快捷键列表 mocks/shortcuts.ts 一致）：
 * N 新建文档 · K 快速跳转 · ⇧F 全局搜索 · , 设置 · W 关闭标签页 ·
 * S 保存 · D 收藏 · \ 侧栏 · P 放映画板 · J 更多菜单。
 *
 * @returns keydown 事件处理器，配合 hooks/useKeyboardShortcuts 挂载
 */
export function useWorkspaceShortcuts(actions: ShortcutActions) {
  const {
    createDoc,
    closeActiveTab,
    toggleStar,
    toggleSidebar,
    toggleMoreMenu,
    openSettings,
    quickJump,
    globalSearch,
    saveDoc,
    presentBoard,
  } = actions;

  return (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();

    if (key === "n") {
      event.preventDefault();
      createDoc();
    } else if (key === "k") {
      event.preventDefault();
      quickJump();
    } else if (key === "f" && event.shiftKey) {
      event.preventDefault();
      globalSearch();
    } else if (key === ",") {
      event.preventDefault();
      openSettings();
    } else if (key === "w") {
      event.preventDefault();
      closeActiveTab();
    } else if (key === "s") {
      event.preventDefault();
      saveDoc();
    } else if (key === "d") {
      event.preventDefault();
      toggleStar();
    } else if (key === "\\") {
      event.preventDefault();
      toggleSidebar();
    } else if (key === "p") {
      event.preventDefault();
      presentBoard();
    } else if (key === "j") {
      event.preventDefault();
      toggleMoreMenu();
    }
  };
}
