import type { ChainedCommands } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface SlashCommand {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  /** 是否为 mock 占位（表格等未实现项） */
  mock?: boolean;
  apply?: (api: { deleteSlash: () => ChainedCommands }) => void;
}

export interface SlashMenuProps {
  /** 锚定编辑器光标的视口坐标 */
  position: { x: number; y: number };
  commands: SlashCommand[];
  onSelect: (command: SlashCommand) => void;
}

/** 分组 caption 值：组间分隔 */
function groupLabel(cmd: SlashCommand, index: number, all: SlashCommand[]): string | null {
  if (index === 0 || all[index - 1].group !== cmd.group) return cmd.group;
  return null;
}

/** 弹窗 I · Slash 命令菜单：220px 锚定光标浮层，高亮 = bg-accent */
export function SlashMenu({ position, commands, onSelect }: SlashMenuProps) {
  return (
    <div
      role="menu"
      aria-label="Slash 命令"
      className="anim-slide-up-in fixed z-50"
      style={{ left: position.x, top: position.y }}
      // 按下不抢焦点，保持编辑器选区
      onMouseDown={(e) => e.preventDefault()}
    >
      <ScrollArea className="max-h-[280px] w-[220px] rounded-md border border-border bg-popover p-1.5 shadow-md">
        {commands.map((cmd, i) => {
          const label = groupLabel(cmd, i, commands);
          return (
            <div key={cmd.id}>
              {label && (
                <div className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium tracking-[0.3px] text-muted-foreground">
                  {label}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => onSelect(cmd)}
                className={cn(
                  "flex w-full cursor-default items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[13px] text-foreground transition-colors duration-150 ease-[var(--ease)] hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
                  cmd.mock && "text-muted-foreground",
                )}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-secondary">
                  <cmd.icon className="size-3.5" />
                </span>
                <span className="truncate">{cmd.label}</span>
              </button>
            </div>
          );
        })}
      </ScrollArea>
    </div>
  );
}
