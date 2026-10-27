import { Download, FileUp, LayoutTemplate, Package, Settings, Store, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

export interface MoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
  /** 打开整库导出弹窗 */
  onAllExport: () => void;
  /** 打开导入弹窗（根级） */
  onImport: () => void;
  /** 直接导入思维导图文件 */
  onImportMindmap: () => void;
  /** 打开组件库管理 */
  onOpenLibrary: () => void;
  /** 打开备份与恢复 */
  onBackup: () => void;
  /** 打开模板库 */
  onTemplates: () => void;
  /** 打开文件回收站 */
  onNodeTrash: () => void;
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
  onImportMindmap,
  onOpenLibrary,
  onBackup,
  onTemplates,
  onNodeTrash,
  children,
}: MoreMenuProps) {
  const { t } = useI18n();
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[260px]">
        <DropdownMenuItem onSelect={onOpenSettings}>
          <Settings />
          {t("设置")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onTemplates}>
          <LayoutTemplate />
          {t("模板库")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenLibrary}>
          <Package />
          {t("组件库")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAllExport}>
          <Download />
          {t("全部导出")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImport}>
          <FileUp />
          {t("导入…")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportMindmap}>
          <FileUp />
          {t("导入思维导图…")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNodeTrash}>
          <Trash2 />
          {t("回收站")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onBackup}>
          <Store />
          {t("备份与恢复")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
