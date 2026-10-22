import type { Editor } from "@tiptap/react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export interface SlashCommand {
  id: string;
  label: string;
  group: string;
  /** 一句话说明，帮助用户区分相近块 */
  description?: string;
  icon: LucideIcon;
  /** 额外检索词（拼音/英文） */
  keywords?: string[];
  run: (editor: Editor) => void;
}

export interface SlashMenuProps {
  /** 锚定编辑器光标的视口坐标 */
  position: { x: number; y: number };
  commands: SlashCommand[];
  activeIndex: number;
  onSelect: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}

/** 按 label/id/keywords 过滤；空查询返回全部。 */
export function filterSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return commands;
  return commands.filter((command) => {
    if (command.label.toLowerCase().includes(keyword)) return true;
    if (command.id.toLowerCase().includes(keyword)) return true;
    return command.keywords?.some((word) => word.toLowerCase().includes(keyword)) ?? false;
  });
}

function groupLabel(command: SlashCommand, index: number, all: SlashCommand[]): string | null {
  if (index === 0 || all[index - 1].group !== command.group) return command.group;
  return null;
}

/** Slash 命令菜单：过滤、↑↓ 选择、Enter 插入。 */
export function SlashMenu({ position, commands, activeIndex, onSelect, onHover }: SlashMenuProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const width = 304;
  const left = Math.max(8, Math.min(position.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(position.y, Math.max(8, window.innerHeight - 392)));

  return (
    <div
      role="menu"
      aria-label="Slash 命令"
      className="editor-float anim-pop-in fixed z-50 w-[304px] overflow-hidden"
      style={{ left, top }}
      // 按下不抢焦点，保持编辑器选区
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          插入内容
        </span>
        <kbd className="editor-kbd">/</kbd>
      </div>
      <div className="max-h-[320px] overflow-y-auto overscroll-contain p-1.5" role="presentation">
        {commands.length === 0 && (
          <div className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">没有匹配的命令</div>
        )}
        {commands.map((command, index) => {
          const label = groupLabel(command, index, commands);
          const active = index === activeIndex;
          return (
            <div key={command.id}>
              {label && <div className="editor-menu-label">{label}</div>}
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                data-active={active}
                onClick={() => onSelect(command)}
                onMouseEnter={() => onHover(index)}
                className="editor-menu-item"
              >
                <span className="editor-menu-icon">
                  <command.icon className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-5">{command.label}</span>
                  {command.description && (
                    <span className="block truncate text-[11px] leading-4 text-muted-foreground">
                      {command.description}
                    </span>
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t border-border/70 px-3 py-2 text-[10.5px] text-muted-foreground">
        <span>↑↓ 选择</span>
        <span aria-hidden="true">·</span>
        <span>Enter 插入</span>
        <span aria-hidden="true">·</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
}
