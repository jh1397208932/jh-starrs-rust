import { Download, FileUp, LayoutTemplate, Package, Settings, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  /** 打开整库导出弹窗 */
  onAllExport: () => void;
  /** 打开导入弹窗（根级） */
  onImport: () => void;
  /** 打开组件库管理 */
  onOpenLibrary: () => void;
  /** 未实现功能统一 toast */
  onMockAction: (label: string) => void;
  children: React.ReactNode;
}

/**
 * 弹窗 B · 更多菜单：260px 锚定弹出（按钮上方）。
 * 设置 → 弹窗 C；未实现项统一走 mock toast。
 */
export function MoreMenu({
  open,
  onOpenChange,
  onOpenSettings,
  onAllExport,
  onImport,
  onOpenLibrary,
  onMockAction,
  children,
}: MoreMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[260px]">
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings />
          设置
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMockAction("模板库")}>
          <LayoutTemplate />
          模板库
          <span className="ml-auto text-[10.5px] text-muted-foreground">即将推出</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenLibrary}>
          <Package />
          组件库
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAllExport}>
          <Download />
          全部导出
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>
          <FileUp />
          导入…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMockAction("备份与恢复")}>
          <Store />
          备份与恢复
          <span className="ml-auto text-[10.5px] text-muted-foreground">即将推出</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
