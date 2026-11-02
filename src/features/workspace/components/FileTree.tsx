import { Plus, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NodeKindIcon } from "@/components/common/NodeKindIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { EASE_STANDARD } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { NodeItem, TreeNode, UploadMode } from "@/types/notebook";
import { useFileTreeDrag } from "../hooks/useFileTreeDrag";
import { FileTreeRow } from "./FileTreeRow";

export interface FileTreeProps {
  /** 当前知识库递归树 */
  tree: TreeNode[];
  /** 当前知识库平表（拖拽索引计算用） */
  nodes: NodeItem[];
  /** 当前知识库名称；null = 工作区还没有知识库 */
  currentKbName: string | null;
  /** 当前激活标签对应节点 */
  selectedNodeId: string | null;
  onOpenNode: (node: NodeItem) => void;
  onCreateRoot: () => void;
  onCreateChild: (parent: NodeItem) => void;
  onRename: (node: NodeItem) => void;
  onDelete: (node: NodeItem) => void;
  /** 导入到此文件夹 */
  onImportToFolder: (parent: NodeItem) => void;
  /** 上传附件到根或指定文件夹 */
  onUploadAttachment: (parent: NodeItem | null, mode?: UploadMode) => void;
  /** 拖动移动；失败由拖拽 hook 调 onError */
  onMove: (id: string, parentId: string | null, index: number) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * 左侧文件树：任意层级、文件夹展开/折叠、节点 CRUD 菜单与 HTML5 拖拽。
 * 行渲染在 FileTreeRow；拖拽规则在 useFileTreeDrag；本组件负责状态、键盘导航与空态。
 */
export function FileTree({
  tree,
  nodes,
  currentKbName,
  selectedNodeId,
  onOpenNode,
  onCreateRoot,
  onCreateChild,
  onRename,
  onDelete,
  onImportToFolder,
  onUploadAttachment,
  onMove,
  onError,
}: FileTreeProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // 稳定引用：作为 drag 控制器的依赖，保证 FileTreeRow 的 memo 生效。
  const expandFolder = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // 同样要稳定引用：每次自动保存重渲染时若换新函数，FileTreeRow 的 memo 会整树击穿。
  const toggleFolder = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const drag = useFileTreeDrag({ nodes, onMove, onError, onExpand: expandFolder });
  const draggedNode = drag.draggedId ? (nodes.find((node) => node.id === drag.draggedId) ?? null) : null;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (index < 0 && event.key !== "ArrowDown") return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next =
        event.key === "ArrowDown"
          ? Math.min(rows.length - 1, index + 1)
          : Math.max(0, index < 0 ? 0 : index - 1);
      rows[next]?.focus();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const folderId = rows[index]?.dataset.folderId;
      if (!folderId) return;
      event.preventDefault();
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (event.key === "ArrowRight") next.delete(folderId);
        else next.add(folderId);
        return next;
      });
    }
  };

  // 拖拽落点指示：单条线在目标行之间连续滑动（CSS transition 只动 transform/width，合成层动画）。
  const treeRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{ x: number; y: number; width: number } | null>(null);
  const [lineAnimated, setLineAnimated] = useState(false);
  const placeIndicator = useCallback(() => {
    const hint = drag.dropHint;
    const tree = treeRef.current;
    if (!hint || hint.position === "inside" || !tree) {
      // 文件夹内部：由行高亮表达，不画线
      setIndicator(null);
      return;
    }
    if (hint.position === "root") {
      const rect = tree.getBoundingClientRect();
      setIndicator({ x: rect.left + 8, y: rect.bottom - 6, width: rect.width - 16 });
      return;
    }
    if (!hint.targetId) {
      setIndicator(null);
      return;
    }
    const row = tree.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(hint.targetId)}"]`);
    if (!row) {
      setIndicator(null);
      return;
    }
    const rect = row.getBoundingClientRect();
    setIndicator({
      x: rect.left + 6,
      y: hint.position === "before" ? rect.top : rect.bottom,
      width: rect.width - 12,
    });
  }, [drag.dropHint]);

  useEffect(() => {
    placeIndicator();
  }, [placeIndicator]);

  // 首次出现禁用过渡（避免从左上角飞入），之后在目标行之间平滑滑动。
  useEffect(() => {
    if (!indicator) {
      setLineAnimated(false);
      return;
    }
    if (lineAnimated) return;
    const frame = requestAnimationFrame(() => setLineAnimated(true));
    return () => cancelAnimationFrame(frame);
  }, [indicator, lineAnimated]);

  // 拖拽时列表会自动滚动或窗口改尺寸：落点线跟随当前行重新测量。
  useEffect(() => {
    if (!drag.dropHint) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeIndicator();
      });
    };
    const tree = treeRef.current;
    tree?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      tree?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [drag.dropHint, placeIndicator]);

  return (
    <div className="mx-2 mt-2 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-2.5 pt-1 pb-1.5">
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[10.5px] font-semibold tracking-[0.14em] text-sidebar-muted uppercase">
          <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-primary/70" />
          {currentKbName ?? t("文件")}
        </span>
        <div className="flex items-center gap-0.5">
          {/* 系统面板一次只能选文件或只能选文件夹：按钮先问一次，再进对应面板。 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("上传附件")}
                disabled={!currentKbName}
                className="grid size-6 cursor-default place-items-center rounded-[8px] text-sidebar-muted transition-colors duration-150 ease-[var(--ease)] hover:bg-card/50 hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Upload className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => onUploadAttachment(null, "files")}>
                {t("选择附件")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onUploadAttachment(null, "folder")}>
                {t("选择文件夹")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("新建内容")}
                disabled={!currentKbName}
                onClick={onCreateRoot}
                className="grid size-6 cursor-default place-items-center rounded-[8px] text-sidebar-muted transition-colors duration-150 ease-[var(--ease)] hover:bg-card/50 hover:text-sidebar-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{currentKbName ? t("新建内容") : t("请先新建知识库")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div
        ref={treeRef}
        role="tree"
        aria-label={t("文件树")}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1 pb-2"
      >
        {!currentKbName ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-sidebar-muted">
            {t("还没有知识库")}
          </p>
        ) : tree.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-sidebar-muted">
            {t("还没有内容")}
          </p>
        ) : (
          <AnimatePresence initial={false}>
            {tree.map((entry) => (
              <FileTreeRow
                key={entry.node.id}
                entry={entry}
                depth={0}
                collapsed={collapsed}
                selectedNodeId={selectedNodeId}
                drag={drag}
                onToggleFolder={toggleFolder}
                onOpenNode={onOpenNode}
                onCreateChild={onCreateChild}
                onRename={onRename}
                onDelete={onDelete}
                onImportToFolder={onImportToFolder}
                onUploadAttachment={onUploadAttachment}
              />
            ))}
          </AnimatePresence>
        )}
        <fieldset
          aria-label={t("移动到顶层")}
          onDragOver={drag.handleRootDragOver}
          onDrop={drag.handleRootDrop}
          className={cn(
            "mt-auto min-h-8 shrink-0 rounded-[10px]",
            drag.draggedId && "border border-dashed border-primary/40",
            drag.dropHint?.position === "root" && "bg-accent",
          )}
        />
      </div>

      <div
        aria-hidden="true"
        data-tree-drop-indicator=""
        className="pointer-events-none fixed top-0 left-0 z-[60] h-0.5 rounded-full bg-primary transition-[transform,width,opacity] duration-150 ease-[var(--ease)]"
        style={{
          transform: `translate3d(${indicator?.x ?? 0}px, ${indicator?.y ?? 0}px, 0)`,
          width: indicator?.width ?? 0,
          opacity: indicator ? 1 : 0,
          transition: lineAnimated ? undefined : "none",
        }}
      />

      {draggedNode
        ? createPortal(
            <motion.div
              className="tree-drag-chip"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.12, ease: EASE_STANDARD }}
              style={{ x: drag.chipX, y: drag.chipY }}
            >
              <NodeKindIcon kind={draggedNode.kind} className="size-3.5 text-primary" />
              <span className="max-w-[180px] truncate">{draggedNode.title}</span>
            </motion.div>,
            document.body,
          )
        : null}
    </div>
  );
}
