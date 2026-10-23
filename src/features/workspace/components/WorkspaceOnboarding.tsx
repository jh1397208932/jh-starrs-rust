import { FolderOpen, HardDrive, Plus } from "lucide-react";
import { useState } from "react";
import { toErrorMessage } from "@/api/client";
import { BrandLogo } from "@/components/common/BrandLogo";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import type { Workspace } from "@/types/notebook";

export interface WorkspaceOnboardingProps {
  /** 已登记的工作区（可能为空） */
  workspaces: Workspace[];
  /** 打开创建向导 */
  onCreateWorkspace: () => void;
  /** 选择本地目录并打开；失败时抛错 */
  onOpenWorkspace: () => Promise<void>;
  /** 切换到已登记工作区；失败时抛错 */
  onSwitchWorkspace: (id: string) => Promise<void>;
}

/**
 * 首次启动引导：没有当前工作区时展示。
 *
 * 使用固定遮罩 + 居中面板（而非 Radix Dialog），原因：此处还会叠加“新建工作区”
 * 模态，两个独立 Dialog 的焦点陷阱会互相争抢；遮罩本身阻止进入空壳主界面。
 */
export function WorkspaceOnboarding({
  workspaces,
  onCreateWorkspace,
  onOpenWorkspace,
  onSwitchWorkspace,
}: WorkspaceOnboardingProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = async () => {
    if (busy) return;
    setBusy("open");
    setError(null);
    try {
      await onOpenWorkspace();
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const handleSwitch = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await onSwitchWorkspace(id);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="app-shell fixed inset-0 z-40 grid place-items-center overflow-y-auto p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-onboarding-title"
        className="w-[520px] max-w-full rounded-[22px] border border-border/60 bg-card/88 p-6 text-popover-foreground shadow-lg backdrop-blur-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="sidebar-mark size-11 rounded-[14px]">
            <BrandLogo size={26} />
          </span>
          <div className="min-w-0">
            <h1
              id="workspace-onboarding-title"
              className="text-[length:var(--text-h2)] font-bold leading-[var(--text-h2-lh)] tracking-[var(--text-h2-ls)]"
            >
              欢迎使用星屿
            </h1>
            <p className="mt-0.5 text-[12px] text-muted-foreground">所有知识库都保存在你选择的本地文件夹中</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={onCreateWorkspace}
            className="flex cursor-default flex-col items-start gap-2 rounded-[14px] border border-primary/25 bg-accent/60 p-4 text-left text-accent-foreground shadow-sm transition-colors duration-150 ease-[var(--ease)] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <Plus className="size-5" />
            <span className="text-[14px] font-semibold">新建工作区</span>
            <span className="text-[11.5px] opacity-80">选择一个空文件夹作为数据根目录</span>
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleOpen()}
            className="flex cursor-default flex-col items-start gap-2 rounded-[14px] border border-border/70 bg-card/70 p-4 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <FolderOpen className="size-5" />
            <span className="text-[14px] font-semibold">{busy === "open" ? "正在打开…" : "打开工作区"}</span>
            <span className="text-[11.5px] text-muted-foreground">选择已含 db/workspace.sqlite3 的目录</span>
          </button>
        </div>

        {workspaces.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <HardDrive className="size-3.5" />
              最近的工作区
            </p>
            <ul className="max-h-[180px] overflow-y-auto rounded-[12px] border border-border/60 bg-card/40">
              {workspaces.map((workspace) => (
                <li key={workspace.id} className="border-b border-border/50 last:border-b-0">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void handleSwitch(workspace.id)}
                    className="flex w-full cursor-default items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/35 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-bold"
                      style={{ backgroundColor: workspace.avatarColor, color: "var(--primary-foreground)" }}
                    >
                      {workspace.name.charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {busy === workspace.id ? "正在切换…" : workspace.name}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {workspace.path}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTimestamp(workspace.lastOpenedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

        <p className="mt-5 text-[11.5px] text-muted-foreground">
          工作区是独立目录：数据库在 db/，附件在 storage/。不同工作区之间完全隔离。
        </p>
      </div>
    </div>
  );
}
