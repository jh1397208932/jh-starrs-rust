import { Cloud, HardDrive } from "lucide-react";
import { useState } from "react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface CreateWorkspaceWizardProps {
  open: boolean;
  /** 受控开关：关闭时组件内部重置表单（X / Esc / 遮罩点击均触发） */
  onOpenChange: (open: boolean) => void;
  /** 「创建工作空间」成功后回调（调用方负责关闭） */
  onCreated: (name: string) => void;
  onMockAction: (label: string) => void;
}

/** 空间头像色点：全部引用主题令牌，随主题联动 */
const AVATAR_COLORS = [
  "var(--primary)",
  "var(--destructive)",
  "var(--logo-c)",
  "var(--glow-b)",
  "var(--accent-foreground)",
  "var(--muted-foreground)",
] as const;

function validateName(name: string): string | null {
  if (name.trim().length === 0) return "空间名称不能为空";
  if (name.startsWith(" ")) return "名称不能以空格开头";
  return null;
}

/**
 * 弹窗 D · 创建工作空间（首启向导）：420px 模态。
 * 存储方式二选卡 + 名称校验 + 存储位置行 + 6 色头像点。
 * 关闭行为走 DialogContent 统一契约（X / Esc / 遮罩均可关），关闭时由 onOpenChange 重置表单。
 */
export function CreateWorkspaceWizard({
  open,
  onOpenChange,
  onCreated,
  onMockAction,
}: CreateWorkspaceWizardProps) {
  const [name, setName] = useState("");
  const [cloudPicked, setCloudPicked] = useState(false);
  const [avatar, setAvatar] = useState<string>(AVATAR_COLORS[0]);
  const [touched, setTouched] = useState(false);

  const error = touched ? validateName(name) : null;
  const canCreate = validateName(name) === null;

  /** 关闭并重置表单（X / Esc / 遮罩 / 创建成功后统一走这里） */
  const closeAndReset = () => {
    setName("");
    setCloudPicked(false);
    setAvatar(AVATAR_COLORS[0]);
    setTouched(false);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeAndReset();
      }}
    >
      <DialogContent className="w-[420px] p-6">
        <div className="flex items-center gap-3">
          <BrandLogo size={32} />
          <DialogHeader title="创建工作空间" description="工作空间是文档、画板与知识库的容器" />
        </div>

        {/* 存储方式二选卡 */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setCloudPicked(false)}
            aria-pressed={!cloudPicked}
            className={cn(
              "flex cursor-default flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              !cloudPicked
                ? "border-primary bg-accent text-accent-foreground"
                : "border-border bg-card hover:bg-secondary",
            )}
          >
            <HardDrive className="size-4" />
            <span className="text-[13px] font-semibold">本地文件</span>
            <span className="text-[11.5px] opacity-80">数据保存在本机</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCloudPicked(true);
              onMockAction("云同步存储");
            }}
            aria-pressed={cloudPicked}
            className="flex cursor-default flex-col items-start gap-1 rounded-md border border-border bg-card p-3 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Cloud className="size-4" />
            <span className="text-[13px] font-semibold">云同步</span>
            <span className="text-[11.5px] text-muted-foreground">暂未支持</span>
          </button>
        </div>

        {/* 名称 */}
        <div className="mt-4">
          <label htmlFor="ws-name" className="mb-1.5 block text-[13px] font-medium">
            空间名称
          </label>
          <Input
            id="ws-name"
            value={name}
            placeholder="例如：星屿工作区"
            aria-invalid={error !== null}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
            className={error ? "border-destructive" : undefined}
          />
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
        </div>

        {/* 存储位置 */}
        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium">存储位置</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[10px] border border-input bg-muted px-3 py-2 font-mono text-[12px] text-muted-foreground">
              ~/Starris/{name.trim() || "未命名工作空间"}
            </code>
            <Button variant="outline" size="sm" onClick={() => onMockAction("选择文件夹")}>
              选择文件夹…
            </Button>
          </div>
        </div>

        {/* 头像色点 */}
        <div className="mt-4">
          <span className="mb-1.5 block text-[13px] font-medium">空间头像</span>
          <div className="flex gap-2">
            {AVATAR_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`选择头像色 ${color}`}
                aria-pressed={avatar === color}
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

        <div className="mt-6">
          <Button
            className="w-full"
            disabled={!canCreate}
            onClick={() => {
              if (canCreate) {
                onCreated(name.trim());
                closeAndReset();
              }
            }}
          >
            创建工作空间
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
