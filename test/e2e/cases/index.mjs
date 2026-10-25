import onboarding from "./00-onboarding.mjs";
import shell from "./10-shell.mjs";
import tree from "./20-tree.mjs";
import attachmentTree from "./25-attachment-tree.mjs";
import doc from "./30-doc.mjs";
import board from "./40-board.mjs";
import settings from "./50-settings.mjs";
import library from "./60-library.mjs";
import importExport from "./70-import-export.mjs";
import shortcuts from "./80-shortcuts.mjs";
import shortcutSettings from "./85-shortcut-settings.mjs";
import shortcutScopes from "./87-shortcut-scopes.mjs";
import workspaceKb from "./90-workspace-kb.mjs";
import interactions from "./95-interactions.mjs";
import misc from "./96-misc.mjs";

/** 新增功能：只需在 test/e2e/cases 新增文件并在这里登记。 */
export default [
  onboarding,
  shell,
  tree,
  attachmentTree,
  doc,
  board,
  settings,
  library,
  importExport,
  shortcuts,
  shortcutSettings,
  shortcutScopes,
  workspaceKb,
  interactions,
  misc,
];
