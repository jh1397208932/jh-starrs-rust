import onboarding from "./00-onboarding.mjs";
import shell from "./10-shell.mjs";
import language from "./12-language.mjs";
import tree from "./20-tree.mjs";
import treeLarge from "./20b-tree-large.mjs";
import importMindmap from "./21-import-mindmap.mjs";
import network from "./23-network.mjs";
import nodeTrash from "./24-node-trash.mjs";
import attachmentTree from "./25-attachment-tree.mjs";
import mindmap from "./26-mindmap.mjs";
import mindmapVisual from "./26b-mindmap-visual.mjs";
import mindmapExtreme from "./26c-mindmap-extreme.mjs";
import aiCollab from "./27-ai-collab.mjs";
import mcpHost from "./28-mcp-host.mjs";
import mcpReview from "./29-mcp-review.mjs";
import doc from "./30-doc.mjs";
import docExtreme from "./30b-doc-extreme.mjs";
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
import docEmbed from "./97b-doc-embed.mjs";
import docConflict from "./98-doc-conflict.mjs";
import closeFlush from "./99-close-flush.mjs";

/** 新增功能：只需在 test/e2e/cases 新增文件并在这里登记。 */
export default [
  onboarding,
  shell,
  language,
  tree,
  treeLarge,
  importMindmap,
  network,
  nodeTrash,
  attachmentTree,
  mindmap,
  mindmapVisual,
  mindmapExtreme,
  aiCollab,
  mcpHost,
  mcpReview,
  doc,
  docExtreme,
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
  docEmbed,
  docConflict,
  closeFlush,
];
