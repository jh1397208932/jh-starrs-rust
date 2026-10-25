import { Layers, Loader2 } from "lucide-react";
import { useState } from "react";
import { toErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import type { LibraryItem } from "@/types/library";

export interface BoardLibraryPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: LibraryItem[];
  onInsert: (item: LibraryItem) => Promise<void>;
  onError: (message: string) => void;
}

/** 从启用的组件库选择组件插入画板。 */
export function BoardLibraryPickerDialog({
  open,
  onOpenChange,
  items,
  onInsert,
  onError,
}: BoardLibraryPickerDialogProps) {
  const [inserting, setInserting] = useState<string | null>(null);

  const handleInsert = async (item: LibraryItem) => {
    setInserting(item.id);
    try {
      await onInsert(item);
      onOpenChange(false);
    } catch (error) {
      onError(toErrorMessage(error));
    } finally {
      setInserting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[560px] max-w-[92vw] gap-4 p-5">
        <DialogHeader title="组件库" />
        <div className="min-h-[220px] max-h-[56vh] overflow-y-auto rounded-[12px] border border-border/60">
          {items.length === 0 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
              <Layers className="size-7 text-muted-foreground/60" />
              <p className="text-[13px] font-medium text-foreground">没有可用组件</p>
              <p className="text-[11.5px] text-muted-foreground">请先在「更多 → 组件库」中启用。</p>
            </div>
          ) : (
            <ul aria-label="组件列表">
              {items.map((item, index) => (
                <li key={item.id} className="border-b border-border/50 last:border-b-0">
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left"
                    disabled={inserting !== null}
                    onClick={() => void handleInsert(item)}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-secondary text-muted-foreground">
                      <Layers className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">
                        {item.name || `组件 ${index + 1}`}
                      </span>
                      <span className="block truncate text-[10.5px] text-muted-foreground">
                        {item.elements.length} 个形状
                      </span>
                    </span>
                    {inserting === item.id ? (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    ) : null}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
