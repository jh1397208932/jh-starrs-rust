/**
 * 工作区 IPC 封装：启动数据、CRUD、统一连接切换与目录建议。
 * 组件禁止直接 invoke，必须经本模块（AGENTS.md §3.3）。
 */

import { invokeCommand } from "@/api/client";
import type { DeleteWorkspaceResult, Workspace, WorkspaceBootstrap } from "@/types/notebook";

/** Rust `WorkspaceDto` 原始结构 */
interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  avatarColor: string;
  isCurrent: boolean;
  lastOpenedAt: number;
}

/** Rust `BootstrapDto` 原始结构 */
interface BootstrapDto {
  workspaces: WorkspaceDto[];
  currentWorkspace: WorkspaceDto | null;
  memory: Record<string, string>;
  defaultWorkspaceParent: string;
}

/** Rust `DeleteWorkspaceResult` 原始结构 */
interface DeleteWorkspaceResultDto {
  nextWorkspace: WorkspaceDto | null;
  folderRemoved: boolean;
  warning: string | null;
}

/** 新建工作区参数 */
export interface CreateWorkspaceParams {
  /** 显示名称（1~80 字符） */
  name: string;
  /** 用户选择的目标目录本身（绝对路径） */
  path: string;
  /** 头像色令牌，缺省由后端使用主色 */
  avatarColor?: string;
}

/**
 * 读取启动引导数据：工作区、当前工作区、全部记忆与默认新建目录。
 * @returns 启动 DTO
 * @example const data = await getBootstrap(); // data.currentWorkspace?.name
 */
export async function getBootstrap(): Promise<WorkspaceBootstrap> {
  const dto = await invokeCommand<BootstrapDto>("app_bootstrap");
  return {
    workspaces: dto.workspaces.map(mapWorkspace),
    currentWorkspace: dto.currentWorkspace ? mapWorkspace(dto.currentWorkspace) : null,
    memory: dto.memory,
    defaultWorkspaceParent: dto.defaultWorkspaceParent,
  };
}

/**
 * 查询全部已登记工作区（按最近打开倒序）。
 * @returns 工作区数组
 * @example const list = await listWorkspaces();
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const dtos = await invokeCommand<WorkspaceDto[]>("workspace_list");
  return dtos.map(mapWorkspace);
}

/**
 * 新建本地工作区并自动切换（后端统一入口）。
 * @param params 名称、目标目录与头像色
 * @returns 新建后处于当前状态的工作区
 * @example await createWorkspace({ name: "星屿", path: "/Users/me/Starris" });
 */
export async function createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
  const dto = await invokeCommand<WorkspaceDto>("workspace_create", {
    input: {
      name: params.name,
      path: params.path,
      avatarColor: params.avatarColor ?? "var(--primary)",
    },
  });
  return mapWorkspace(dto);
}

/**
 * 打开已有工作区；目录必须包含 `db/workspace.sqlite3`。
 * @param path 已存在的目录绝对路径
 * @returns 已切换到该工作区
 * @example await openWorkspace("/Volumes/Data/设计库");
 */
export async function openWorkspace(path: string): Promise<Workspace> {
  const dto = await invokeCommand<WorkspaceDto>("workspace_open", { path });
  return mapWorkspace(dto);
}

/**
 * 手动切换工作区（后端唯一连接切换入口）。
 * @param id 工作区 id
 * @returns 切换后的工作区
 * @example await switchWorkspace(ws.id);
 */
export async function switchWorkspace(id: string): Promise<Workspace> {
  const dto = await invokeCommand<WorkspaceDto>("workspace_switch", { id });
  return mapWorkspace(dto);
}

/**
 * 重命名工作区（只改全局显示名，不改目录）。
 * @param id 工作区 id
 * @param name 新名称（1~80 字符）
 * @returns 更新后的工作区
 * @example await renameWorkspace(ws.id, "新的名字");
 */
export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const dto = await invokeCommand<WorkspaceDto>("workspace_rename", { input: { id, name } });
  return mapWorkspace(dto);
}

/**
 * 删除工作区；当前工作区会由后端自动切换到最近使用的其他工作区。
 * @param id 工作区 id
 * @param deleteFolder 是否连同本地文件夹一起删除
 * @returns 删除结果（含下一个工作区与部分成功 warning）
 * @example await deleteWorkspace(ws.id, false);
 */
export async function deleteWorkspace(id: string, deleteFolder: boolean): Promise<DeleteWorkspaceResult> {
  const dto = await invokeCommand<DeleteWorkspaceResultDto>("workspace_delete", {
    input: { id, deleteFolder },
  });
  return {
    nextWorkspace: dto.nextWorkspace ? mapWorkspace(dto.nextWorkspace) : null,
    folderRemoved: dto.folderRemoved,
    warning: dto.warning,
  };
}

/** DTO → 领域类型 */
function mapWorkspace(dto: WorkspaceDto): Workspace {
  return {
    id: dto.id,
    name: dto.name,
    path: dto.path,
    avatarColor: dto.avatarColor,
    isCurrent: dto.isCurrent,
    lastOpenedAt: dto.lastOpenedAt,
  };
}
