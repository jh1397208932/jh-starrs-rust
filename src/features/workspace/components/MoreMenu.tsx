import { Download, FileUp, LayoutTemplate, Package, Settings, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  /** 未实现功能统一 toast */
  onMockAction: (label: string) => void;
  children: React.ReactNode;
}

const SETTINGS_TABS = ["通用", "外观", "快捷键", "存储", "云同步", "关于"];

/**
 * 弹窗 B · 更多菜单：260px 锚定弹出（按钮上方）。
 * 设置 → 弹窗 C；未实现项统一走 mock toast。
 */
export function MoreMenu({ open, onOpenChange, onOpenSettings, onMockAction, children }: MoreMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[260px]">
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings />
          设置
        </DropdownMenuItem>
        <DropdownMenuLabel>{SETTINGS_TABS.join(" · ")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMockAction("模板库")}>
          <LayoutTemplate />
          模板库
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMockAction("组件库")}>
          <Package />
          组件库
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMockAction("全部导出")}>
          <Download />
          全部导出
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMockAction("导入文档")}>
          <FileUp />
          导入文档
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMockAction("备份与恢复")}>
          <Store />
          备份与恢复
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
