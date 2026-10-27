import onboarding from "./00-onboarding.mjs";
import shell from "./10-shell.mjs";
import language from "./12-language.mjs";
import tree from "./20-tree.mjs";
import tableFlow from "./22-table-flow.mjs";
import network from "./23-network.mjs";
import nodeTrash from "./24-node-trash.mjs";
import attachmentTree from "./25-attachment-tree.mjs";
import mindmap from "./26-mindmap.mjs";
import aiCollab from "./27-ai-collab.mjs";
import mcpHost from "./28-mcp-host.mjs";
import doc from "./30-doc.mjs";
import board from "./40-board.mjs";
import settings from "./50-settings.mjs";
import library from "./60-library.mjs";
import importExport from "./70-import-export.mjs";
import shortcuts from "./80-shortcuts.mjs";
import shortcutSettings from "./85-shortcut-settings.mjs";
import shortcutScopes from "./87-shortcut-scopes.mjs";
import workspaceKb from "./90-workspace-kb.mjs";
import backup from "./91-backup.mjs";
import template from "./92-template.mjs";
import boardPresent from "./93-board-present.mjs";
import docHistory from "./94-doc-history.mjs";
import interactions from "./95-interactions.mjs";
import misc from "./96-misc.mjs";
import search from "./97-search.mjs";
import docConflict from "./98-doc-conflict.mjs";
import closeFlush from "./99-close-flush.mjs";

/** 新增功能：只需在 test/e2e/cases 新增文件并在这里登记。 */
export default [
  onboarding,
  shell,
  language,
  tree,
  tableFlow,
  network,
  nodeTrash,
  attachmentTree,
  mindmap,
  aiCollab,
  mcpHost,
  doc,
  board,
  settings,
  library,
  importExport,
  shortcuts,
  shortcutSettings,
  shortcutScopes,
  workspaceKb,
  backup,
  template,
  boardPresent,
  docHistory,
  interactions,
  misc,
  search,
  docConflict,
  closeFlush,
];
