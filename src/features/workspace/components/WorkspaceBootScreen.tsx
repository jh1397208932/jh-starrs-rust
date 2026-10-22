import { LoaderCircle, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { Button } from "@/components/ui/button";

export interface WorkspaceBootScreenProps {
  mode: "loading" | "error";
  /** 错误模式下的可展示消息 */
  message?: string;
  onRetry?: () => void;
}

/** 启动加载 / 启动失败页：全局库打开失败时应用无法进入主界面 */
export function WorkspaceBootScreen({ mode, message, onRetry }: WorkspaceBootScreenProps) {
  return (
    <div className="grid h-full place-items-center bg-background px-6" aria-live="polite">
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <BrandLogo size={40} />
        {mode === "loading" ? (
          <>
            <LoaderCircle className="mt-6 size-5 animate-spin text-primary" />
            <p className="mt-3 text-[13px] text-muted-foreground">正在加载工作区…</p>
          </>
        ) : (
          <>
            <TriangleAlert className="mt-6 size-6 text-destructive" />
            <h1 className="mt-3 text-[18px] font-semibold">无法加载工作区</h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {message ?? "请检查应用数据目录权限后重试。"}
            </p>
            {onRetry && (
              <Button className="mt-5" size="sm" onClick={onRetry}>
                重试
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
