import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { toErrorMessage } from "@/api/client";
import type { CreateWorkspaceParams } from "@/api/workspace";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t, useI18n } from "@/lib/i18n";
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
  if (trimmed.length === 0) return t("请输入名称");
  if (trimmed.length > 80) return t("名称不能超过 80 个字符");
  return null;
}

/** 路径校验：必须是绝对路径；后端仍会做最终校验 */
function validatePath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.length === 0) return t("请选择位置");
  if (!/^([A-Za-z]:[\\/]|[\\/])/.test(trimmed)) return t("请输入完整路径");
  return null;
}

/** 由名称推导默认目标目录：<父目录>/<安全名称> */
function derivePath(parent: string, name: string): string {
  if (!parent) return "";
  const cleaned =
    Array.from(name.trim())
      .map((char) => (char.charCodeAt(0) < 32 || /[\\/:*?"<>|]/.test(char) ? "-" : char))
      .join("")
      .replace(/^[.\s]+|[.\s]+$/g, "") || t("新工作区");
  // Windows 设备保留名（CON/PRN/NUL/COM1…）不能作为目录名，追加后缀规避。
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(cleaned);
  const safeName = reserved ? `${cleaned}-1` : cleaned;
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
  const { t } = useI18n();
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
          <DialogHeader title={t("创建工作区")} />
        </div>

        <div className="mt-4">
          <label htmlFor="ws-name" className="mb-1.5 block text-[13px] font-medium">
            {t("名称")}
          </label>
          <Input
            id="ws-name"
            value={name}
            placeholder={t("名称")}
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
            {t("位置")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="ws-path"
              value={path}
              placeholder={t("选择文件夹")}
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
              {t("选择…")}
            </Button>
          </div>
          {pathTouched && pathError && <p className="mt-1.5 text-[12px] text-destructive">{pathError}</p>}
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">{t("目录需为空")}</p>
        </div>

        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium">{t("颜色")}</span>
          <div className="flex gap-2">
            {AVATAR_COLORS.map((color, index) => (
              <button
                key={color}
                type="button"
                aria-label={t("颜色 {index}", { index: index + 1 })}
                aria-pressed={avatar === color}
                disabled={pending}
                onClick={() => setAvatar(color)}
                className={cn(
                  "size-6 cursor-default rounded-full transition-shadow duration-150 ease-[var(--ease)]",
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
            {t("取消")}
          </Button>
          <Button className="min-w-[96px]" disabled={!canCreate} onClick={() => void submit()}>
            {pending ? t("创建中…") : t("创建")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
