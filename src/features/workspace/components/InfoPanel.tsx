import { type ReactNode, useState } from "react";
import { MagicCard } from "@/components/common/motion/MagicCard";
import { NumberTicker } from "@/components/common/motion/NumberTicker";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { KnowledgeBase, NodeItem, RelatedItem } from "@/types/notebook";

export interface InfoPanelProps {
  node: NodeItem | null;
  kb: KnowledgeBase | null;
  related: RelatedItem[];
  onBackToInfo: () => void;
}

type InfoTab = "info" | "backlinks" | "related";

const TABS: { id: InfoTab; label: string }[] = [
  { id: "info", label: "信息" },
  { id: "backlinks", label: "反链" },
  { id: "related", label: "相关" },
];

interface FieldRow {
  label: string;
  /** 字段值：字数行为 NumberTicker 滚动数字，其余为纯文本 */
  value: ReactNode;
}

/**
 * 260px 右信息面板：分段控件（信息/反链/相关）+ 字段列表 + 底部统计。
 * 背景 bg-card；激活段 = bg-card + shadow-sm + 650 字重（原型 .seg）；
 * 字数用 NumberTicker 弹簧滚动；「相关」项为 MagicCard 渐变边卡片（悬浮聚光）。
 */
export function InfoPanel({ node, kb, related, onBackToInfo }: InfoPanelProps) {
  const [tab, setTab] = useState<InfoTab>("info");

  const wordTicker = (
    <NumberTicker value={node?.wordCount ?? 0} className="text-[13px] font-medium text-foreground" />
  );

  const fields: FieldRow[] = node
    ? [
        { label: "字数", value: wordTicker },
        { label: "创建时间", value: "2026-10-12 09:30" },
        { label: "最近更新", value: node.updatedAt },
        { label: "所在知识库", value: kb?.name ?? "—" },
        { label: "存储位置", value: `~/Starris/星屿工作区/${kb?.name ?? ""}` },
        { label: "引用关系", value: "0 条反链" },
      ]
    : [
        { label: "字数", value: wordTicker },
        { label: "创建时间", value: "刚刚" },
        { label: "最近更新", value: "刚刚" },
        { label: "所在知识库", value: kb?.name ?? "—" },
        { label: "存储位置", value: `~/Starris/星屿工作区/${kb?.name ?? ""}` },
        { label: "引用关系", value: "0 条反链" },
      ];

  return (
    <div className="flex h-full flex-col bg-card text-card-foreground">
      {/* 分段控件 */}
      <div className="p-3 pb-2">
        <div
          role="tablist"
          aria-label="信息面板"
          className="grid grid-cols-3 gap-1 rounded-full bg-muted p-1"
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "cursor-default rounded-full py-1 text-[12.5px] transition-[background-color,box-shadow,color] duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
                tab === id
                  ? "bg-card font-[650] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 px-4 pb-2">
        {tab === "info" && (
          <dl>
            {fields.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2.5 last:border-b-0"
              >
                <dt className={cn(CAPTION_CLS, "shrink-0 text-muted-foreground")}>{label}</dt>
                <dd className="min-w-0 truncate text-right text-[13px] text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {tab === "backlinks" && (
          <EmptyState glyph="⛓" title="暂无反向链接" description="在其他文档中 [[引用]] 本文档后显示">
            <button
              type="button"
              onClick={onBackToInfo}
              className="cursor-default text-[13px] text-muted-foreground underline-offset-4 transition-colors duration-150 ease-[var(--ease)] hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              切到「信息」
            </button>
          </EmptyState>
        )}

        {tab === "related" &&
          (related.length === 0 ? (
            <EmptyState glyph="⛓" title="暂无相关文档" description="继续编辑后会出现智能推荐" />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {related.map((item) => (
                <li key={item.id}>
                  <MagicCard className="rounded-lg" gradientSize={140} gradientOpacity={0.5}>
                    <button
                      type="button"
                      className="w-full cursor-default rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="block truncate text-[13px] text-foreground">{item.title}</span>
                      <span className={cn(CAPTION_CLS, "block text-muted-foreground")}>{item.kbName}</span>
                    </button>
                  </MagicCard>
                </li>
              ))}
            </ul>
          ))}
      </ScrollArea>

      {/* 底部统计 */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className={cn(CAPTION_CLS, "truncate text-muted-foreground")}>
          {kb?.name ?? "未命名知识库"} ·{" "}
          <NumberTicker value={node?.wordCount ?? 0} className="text-[12.5px]" /> 字
        </span>
      </div>
    </div>
  );
}
