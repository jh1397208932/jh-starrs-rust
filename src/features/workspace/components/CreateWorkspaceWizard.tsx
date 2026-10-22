import { FolderOpen, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import type { CreateWorkspaceParams } from "@/api/workspace";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CreateWorkspaceWizardProps {
  open: boolean;
  /** 受控开关；异步创建期间忽略关闭 */
  onOpenChange: (open: boolean) => void;
  /** 默认新建父目录（后端返回的 ~/Starris） */
  defaultParent: string;
  /** 打开系统目录选择器；取消返回 null */
  onPickDirectory: (defaultPath?: string) => Promise<string | null>;
  /** 创建并切换工作区；抛错时弹窗保留并展示错误 */
  onCreate: (params: CreateWorkspaceParams) => Promise<void>;
}

/** 空间头像色点：全部引用主题令牌，随主题联动，且是后端白名单 */
const AVATAR_COLORS = [
  "var(--primary)",
  "var(--destructive)",
  "var(--logo-c)",
  "var(--glow-b)",
  "var(--accent-foreground)",
  "var(--muted-foreground)",
] as const;

/** 名称校验：与后端 1~80 字符规则一致（前端只做即时反馈） */
function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "工作区名称不能为空";
  if (trimmed.length > 80) return "工作区名称不能超过 80 个字符";
  return null;
}

/** 路径校验：必须是绝对路径；后端仍会做最终校验 */
function validatePath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length === 0) return "请选择目标文件夹";
  if (!/^([A-Za-z]:[\\/]|[\\/])/.test(trimmed)) return "请使用绝对路径";
  return null;
}

/** 由名称推导默认目标目录：<父目录>/<安全名称> */
function derivePath(parent: string, name: string): string {
  if (!parent) return "";
  const safeName =
    Array.from(name.trim())
      .map((char) => (char.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(char) ? "-" : char))
      .join("")
      .replace(/^[.\s]+|[.\s]+$/g, "") || "新工作区";
  return `${parent.replace(/[\\/]+$/, "")}/${safeName}`;
}

/** 从路径末级推导名称（用户先选文件夹再命名时） */
function nameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/**
 * 弹窗 D · 创建工作空间：420px 模态。
 * 用户选择**目标目录本身**；目录将作为工作区根，自动创建 `db/` 与 `storage/`。
 * 关闭行为走 DialogContent 统一契约；异步创建期间阻止关闭，避免半途取消。
 */
export function CreateWorkspaceWizard({
  open,
  onOpenChange,
  defaultParent,
  onPickDirectory,
  onCreate,
}: CreateWorkspaceWizardProps) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [avatar, setAvatar] = useState<string>(AVATAR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setPath("");
    setPathTouched(false);
    setAvatar(AVATAR_COLORS[0]);
    setError(null);
    setPending(false);
  }, [open]);

  const nameError = validateName(name);
  const pathError = validatePath(path);
  const canCreate = nameError === null && pathError === null && !pending;

  const updateName = (value: string) => {
    setName(value);
    if (!pathTouched) setPath(derivePath(defaultParent, value));
  };

  const chooseFolder = async () => {
    setError(null);
    try {
      const selected = await onPickDirectory(path.trim() || defaultParent || undefined);
      if (!selected) return;
      setPath(selected);
      setPathTouched(true);
      if (!name.trim()) setName(nameFromPath(selected));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  };

  const resetAndClose = () => {
    if (pending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!canCreate) return;
    setPending(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), path: path.trim(), avatarColor: avatar });
      onOpenChange(false);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[440px] p-6">
        <div className="flex items-center gap-3">
          <BrandLogo size={32} />
          <DialogHeader title="创建工作空间" description="工作空间是知识库、文档与附件的本地容器" />
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-md border border-border bg-muted/60 p-3">
          <HardDrive className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold">本地文件夹</p>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              所选目录将成为工作区根目录，自动创建 db/ 与 storage/，数据完全保存在本机。
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="ws-name" className="mb-1.5 block text-[13px] font-medium">
            空间名称
          </label>
          <Input
            id="ws-name"
            value={name}
            placeholder="例如：星屿工作区"
            aria-invalid={name.trim().length > 0 && nameError !== null}
            onChange={(event) => updateName(event.target.value)}
            className={name.trim().length > 0 && nameError ? "border-destructive" : undefined}
          />
          {name.trim().length > 0 && nameError && (
            <p className="mt-1.5 text-[12px] text-destructive">{nameError}</p>
          )}
        </div>

        <div className="mt-4">
          <label htmlFor="ws-path" className="mb-1.5 block text-[13px] font-medium">
            目标文件夹
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="ws-path"
              value={path}
              placeholder="选择或输入一个绝对路径"
              onChange={(event) => {
                setPath(event.target.value);
                setPathTouched(true);
              }}
              className={cn(
                "min-w-0 flex-1 font-mono text-[12px]",
                pathError && pathTouched && "border-destructive",
              )}
            />
            <Button variant="outline" size="sm" disabled={pending} onClick={() => void chooseFolder()}>
              <FolderOpen className="size-3.5" />
              选择…
            </Button>
          </div>
          {pathTouched && pathError && <p className="mt-1.5 text-[12px] text-destructive">{pathError}</p>}
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            目录需为空或不存在；已有工作区请使用“打开工作区”。
          </p>
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium">空间头像</span>
          <div className="flex gap-2">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`选择头像色 ${color}`}
                aria-pressed={avatar === color}
                disabled={pending}
                onClick={() => setAvatar(color)}
                className={cn(
                  "size-6 cursor-default rounded-full transition-shadow duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  avatar === color && "outline-2 outline-offset-2 outline-primary",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-destructive">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={pending} onClick={resetAndClose}>
            取消
          </Button>
          <Button className="min-w-[96px]" disabled={!canCreate} onClick={() => void submit()}>
            {pending ? "创建中…" : "创建工作空间"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
