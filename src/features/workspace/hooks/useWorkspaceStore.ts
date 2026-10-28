import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { waitForAppBootstrap } from "@/api/app";
import { toErrorMessage } from "@/api/client";
import * as kbApi from "@/api/knowledgeBase";
import * as nodeApi from "@/api/node";
import * as workspaceApi from "@/api/workspace";
import { flushActivePersistence } from "@/features/editor/activeDocument";
import { buildTree } from "@/features/workspace/utils/tree";
import { t } from "@/lib/i18n";
import type { DeleteWorkspaceResult, KnowledgeBase, NodeItem, TreeNode, Workspace } from "@/types/notebook";
import { useWorkspaceMemory } from "./useWorkspaceMemory";

/** 工作区 store 对外契约：状态 + 全部数据动作。 */
export interface WorkspaceStore {
  /** 首次启动数据是否已加载完成（成功或失败） */
  ready: boolean;
  /** 正在加载启动数据（首次或刷新） */
  loading: boolean;
  /** 启动或刷新失败的可展示消息 */
  error: string | null;
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  defaultWorkspaceParent: string;
  /** 全局记忆配置快照 */
  memory: Record<string, string>;
  kbs: KnowledgeBase[];
  currentKb: KnowledgeBase | null;
  /** 当前知识库平表节点 */
  nodes: NodeItem[];
  /** 最新节点列表的引用（await refresh 后立即读取，避免闭包里的旧数组） */
  nodesRef: RefObject<NodeItem[]>;
  /** 当前知识库递归树 */
  tree: TreeNode[];
  starredNodes: NodeItem[];
  /** 重新读取启动数据（失败后重试） */
  refresh: () => Promise<void>;
  createWorkspace: (params: workspaceApi.CreateWorkspaceParams) => Promise<Workspace>;
  openWorkspace: (path: string) => Promise<Workspace>;
  switchWorkspace: (id: string) => Promise<Workspace>;
  renameWorkspace: (id: string, name: string) => Promise<Workspace>;
  deleteWorkspace: (id: string, deleteFolder: boolean) => Promise<DeleteWorkspaceResult>;
  switchKb: (id: string) => Promise<void>;
  createKb: (name: string, description: string) => Promise<KnowledgeBase>;
  updateKb: (id: string, params: kbApi.UpdateKnowledgeBaseParams) => Promise<KnowledgeBase>;
  deleteKb: (id: string) => Promise<{ deletedNodes: number }>;
  createNode: (params: nodeApi.CreateNodeParams) => Promise<NodeItem>;
  updateNode: (id: string, params: nodeApi.UpdateNodeParams) => Promise<NodeItem>;
  deleteNode: (id: string) => Promise<{ deletedCount: number }>;
  moveNode: (id: string, parentId: string | null, index: number) => Promise<void>;
  toggleStar: (node: NodeItem) => Promise<NodeItem>;
  /** 文档保存后同步树节点的字数与编辑时间，避免整树重读 */
  applyDocumentSaved: (nodeId: string, info: { wordCount: number; updatedAt: number }) => void;
  /** 画板保存后只同步编辑时间，不改字数。 */
  applyBoardSaved: (nodeId: string, updatedAt: number) => void;
}

/**
 * 工作区领域状态：启动数据、当前工作区/知识库、文件树与全部持久化动作。
 *
 * 所有写操作先调 Rust 再刷新对应切片；切换工作区/知识库时用递增序号丢弃过期响应，
 * 避免快速切换导致旧请求覆盖新状态。UI 提示与弹窗开关由调用方编排。
 */
export function useWorkspaceStore(): WorkspaceStore {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(null);
  const [defaultWorkspaceParent, setDefaultWorkspaceParent] = useState("");
  const { memory, applyMemory, recallCurrentKb, rememberCurrentKb } = useWorkspaceMemory();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [currentKbId, setCurrentKbId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);

  const currentKbRef = useRef<string | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const nodesRef = useRef<NodeItem[]>([]);
  const prevTreeRef = useRef<TreeNode[]>([]);
  const contentSeq = useRef(0);
  const bootstrapSeq = useRef(0);
  const initialized = useRef(false);

  const applyNodes = useCallback((next: NodeItem[]) => {
    nodesRef.current = next;
    setNodes(next);
    const built = buildTree(next, prevTreeRef.current);
    prevTreeRef.current = built;
    setTree(built);
  }, []);

  const loadContent = useCallback(
    async (preferredKbId?: string | null) => {
      const token = ++contentSeq.current;
      const nextKbs = await kbApi.listKnowledgeBases();
      if (token !== contentSeq.current) return;
      const workspaceId = currentWorkspaceIdRef.current;
      const rememberedKbId = workspaceId ? recallCurrentKb(workspaceId) : undefined;
      const preferred = preferredKbId ?? rememberedKbId ?? currentKbRef.current;
      const active = nextKbs.find((kb) => kb.id === preferred) ?? nextKbs[0] ?? null;
      const nextNodes = active ? await nodeApi.listNodes(active.id) : [];
      if (token !== contentSeq.current) return;
      currentKbRef.current = active?.id ?? null;
      setKbs(nextKbs);
      setCurrentKbId(active?.id ?? null);
      applyNodes(nextNodes);
      // 记忆值可能因知识库被删除而失效；以本次实际选中的库回写。
      if (workspaceId && active) {
        void rememberCurrentKb(workspaceId, active.id).catch(() => undefined);
      }
    },
    [applyNodes, recallCurrentKb, rememberCurrentKb],
  );

  const refresh = useCallback(async () => {
    const token = ++bootstrapSeq.current;
    setLoading(true);
    setError(null);
    try {
      const bootstrapError = await waitForAppBootstrap();
      if (bootstrapError) throw new Error(bootstrapError);
      const data = await workspaceApi.getBootstrap();
      if (token !== bootstrapSeq.current) return;
      currentWorkspaceIdRef.current = data.currentWorkspace?.id ?? null;
      setWorkspaces(data.workspaces);
      setCurrentWorkspace(data.currentWorkspace);
      setDefaultWorkspaceParent(data.defaultWorkspaceParent);
      applyMemory(data.memory);
      if (data.currentWorkspace) {
        await loadContent();
      } else {
        contentSeq.current += 1;
        currentKbRef.current = null;
        setKbs([]);
        setCurrentKbId(null);
        applyNodes([]);
      }
      if (token !== bootstrapSeq.current) return;
      setReady(true);
    } catch (caught) {
      if (token !== bootstrapSeq.current) return;
      setError(toErrorMessage(caught));
      setReady(true);
      throw caught;
    } finally {
      if (token === bootstrapSeq.current) setLoading(false);
    }
  }, [applyMemory, applyNodes, loadContent]);

  // StrictMode 会重复执行 effect；用 ref 保证首次启动只请求一次。
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void refresh().catch(() => undefined);
  }, [refresh]);

  /**
   * 工作区切换类动作前必须先落盘当前编辑器。
   *
   * 这些动作会替换工作区会话并清空标签页；未保存内容会在切换后写入新库（或直接丢失）。
   * 保存失败时中止动作，把错误抛给调用方展示。
   */
  const guardBeforeSessionChange = useCallback(async () => {
    const flushed = await flushActivePersistence();
    if (!flushed) {
      throw new Error(t("当前内容尚未保存，请先处理保存失败"));
    }
  }, []);

  const switchWorkspace = useCallback(
    async (id: string) => {
      await guardBeforeSessionChange();
      const workspace = await workspaceApi.switchWorkspace(id);
      await refresh();
      return workspace;
    },
    [guardBeforeSessionChange, refresh],
  );

  const createWorkspace = useCallback(
    async (params: workspaceApi.CreateWorkspaceParams) => {
      await guardBeforeSessionChange();
      const workspace = await workspaceApi.createWorkspace(params);
      await refresh();
      return workspace;
    },
    [guardBeforeSessionChange, refresh],
  );

  const openWorkspace = useCallback(
    async (path: string) => {
      await guardBeforeSessionChange();
      const workspace = await workspaceApi.openWorkspace(path);
      await refresh();
      return workspace;
    },
    [guardBeforeSessionChange, refresh],
  );

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    const updated = await workspaceApi.renameWorkspace(id, name);
    setWorkspaces((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    setCurrentWorkspace((prev) => (prev?.id === updated.id ? updated : prev));
    return updated;
  }, []);

  const deleteWorkspace = useCallback(
    async (id: string, deleteFolder: boolean) => {
      // 删除当前工作区会自动切到别的会话，同样需要先落盘。
      await guardBeforeSessionChange();
      const result = await workspaceApi.deleteWorkspace(id, deleteFolder);
      await refresh();
      return result;
    },
    [guardBeforeSessionChange, refresh],
  );

  const switchKb = useCallback(
    async (id: string) => {
      const workspaceId = currentWorkspaceIdRef.current;
      const token = ++contentSeq.current;
      const nextNodes = await nodeApi.listNodes(id);
      if (token !== contentSeq.current) return;
      // 先落全局记忆再切 UI：写失败则保持原知识库，避免“选择成功但重启丢失”。
      if (workspaceId) await rememberCurrentKb(workspaceId, id);
      if (token !== contentSeq.current) return;
      currentKbRef.current = id;
      setCurrentKbId(id);
      applyNodes(nextNodes);
    },
    [applyNodes, rememberCurrentKb],
  );

  const createKb = useCallback(
    async (name: string, description: string) => {
      const kb = await kbApi.createKnowledgeBase(name, description);
      await loadContent(kb.id);
      return kb;
    },
    [loadContent],
  );

  const updateKb = useCallback(async (id: string, params: kbApi.UpdateKnowledgeBaseParams) => {
    const updated = await kbApi.updateKnowledgeBase(id, params);
    setKbs((prev) => prev.map((kb) => (kb.id === updated.id ? updated : kb)));
    return updated;
  }, []);

  const deleteKb = useCallback(
    async (id: string) => {
      const result = await kbApi.deleteKnowledgeBase(id);
      await loadContent();
      return result;
    },
    [loadContent],
  );

  const reloadNodes = useCallback(async () => {
    const kbId = currentKbRef.current;
    if (!kbId) return;
    const token = ++contentSeq.current;
    const nextNodes = await nodeApi.listNodes(kbId);
    if (token !== contentSeq.current || currentKbRef.current !== kbId) return;
    applyNodes(nextNodes);
  }, [applyNodes]);

  const createNode = useCallback(
    async (params: nodeApi.CreateNodeParams) => {
      const node = await nodeApi.createNode(params);
      await reloadNodes();
      return node;
    },
    [reloadNodes],
  );

  const updateNode = useCallback(
    async (id: string, params: nodeApi.UpdateNodeParams) => {
      const node = await nodeApi.updateNode(id, params);
      await reloadNodes();
      return node;
    },
    [reloadNodes],
  );

  const deleteNode = useCallback(
    async (id: string) => {
      const result = await nodeApi.deleteNode(id);
      await reloadNodes();
      return result;
    },
    [reloadNodes],
  );

  const moveNode = useCallback(
    async (id: string, parentId: string | null, index: number) => {
      const nextNodes = await nodeApi.moveNode(id, parentId, index);
      if (nextNodes.length === 0) {
        await reloadNodes();
        return;
      }
      const kbId = nextNodes[0]?.kbId;
      if (kbId === currentKbRef.current) applyNodes(nextNodes);
    },
    [applyNodes, reloadNodes],
  );

  const toggleStar = useCallback(
    async (node: NodeItem) => {
      const updated = await nodeApi.updateNode(node.id, { starred: !node.starred });
      await reloadNodes();
      return updated;
    },
    [reloadNodes],
  );

  const applyDocumentSaved = useCallback(
    (nodeId: string, info: { wordCount: number; updatedAt: number }) => {
      // 字数与编辑时间都没变时跳过整树更新：自动保存每秒可能触发一次，
      // 每次 map + buildTree + 全树 render 是打字期周期性掉帧来源（2026-10-27 性能任务 B2）。
      const current = nodesRef.current.find((node) => node.id === nodeId);
      if (current && current.wordCount === info.wordCount && current.updatedAt === info.updatedAt) {
        return;
      }
      applyNodes(
        nodesRef.current.map((node) =>
          node.id === nodeId ? { ...node, wordCount: info.wordCount, updatedAt: info.updatedAt } : node,
        ),
      );
    },
    [applyNodes],
  );

  const applyBoardSaved = useCallback(
    (nodeId: string, updatedAt: number) => {
      applyNodes(nodesRef.current.map((node) => (node.id === nodeId ? { ...node, updatedAt } : node)));
    },
    [applyNodes],
  );

  const currentKb = useMemo(() => kbs.find((kb) => kb.id === currentKbId) ?? null, [kbs, currentKbId]);

  const starredNodes = useMemo(() => nodes.filter((node) => node.starred && node.kind !== "folder"), [nodes]);

  return {
    ready,
    loading,
    error,
    workspaces,
    currentWorkspace,
    defaultWorkspaceParent,
    memory,
    kbs,
    currentKb,
    nodes,
    nodesRef,
    tree,
    starredNodes,
    refresh,
    createWorkspace,
    openWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
    switchKb,
    createKb,
    updateKb,
    deleteKb,
    createNode,
    updateNode,
    deleteNode,
    moveNode,
    toggleStar,
    applyDocumentSaved,
    applyBoardSaved,
  };
}
