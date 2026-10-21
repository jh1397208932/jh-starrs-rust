import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";

export interface NewKbDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (name: string, description: string) => void;
}

function validateName(name: string): string | null {
  if (name.trim().length === 0) return "知识库名称不能为空";
  if (name.startsWith(" ")) return "名称不能以空格开头";
  return null;
}

/** 弹窗 E · 新建知识库：400px 模态，名称校验 + 描述选填 */
export function NewKbDialog({ open, onOpenChange, onCreated }: NewKbDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);

  const error = touched ? validateName(name) : null;
  const canCreate = validateName(name) === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px] p-5" aria-describedby={undefined}>
        <DialogTitle>新建知识库</DialogTitle>

        <div className="mt-4">
          <label htmlFor="kb-name" className="mb-1.5 block text-[13px] font-medium">
            名称
          </label>
          <Input
            id="kb-name"
            value={name}
            placeholder="例如：产品灵感库"
            aria-invalid={error !== null}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
            className={error ? "border-destructive" : undefined}
          />
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
        </div>

        <div className="mt-3">
          <label htmlFor="kb-desc" className="mb-1.5 block text-[13px] font-medium">
            描述 <span className="font-normal text-muted-foreground">（选填）</span>
          </label>
          <Textarea
            id="kb-desc"
            value={description}
            placeholder="一句话说明这个知识库收集什么"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            className="min-w-[72px]"
            disabled={!canCreate}
            onClick={() => {
              onCreated(name.trim(), description.trim());
              onOpenChange(false);
            }}
          >
            创建
          </Button>
        </div>
        <DialogDescription className="sr-only">创建一个新的知识库</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
