import { type ReactNode, useState } from "react";
import { MagicCard } from "@/components/common/motion/MagicCard";
import { NumberTicker } from "@/components/common/motion/NumberTicker";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatTimestamp } from "@/features/workspace/utils/tree";
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
  { id: "backlinks", label: "反向链接" },
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
        { label: "新建时间", value: formatTimestamp(node.createdAt) },
        { label: "最近更新", value: formatTimestamp(node.updatedAt) },
        { label: "所在知识库", value: kb?.name ?? "—" },
      ]
    : [
        { label: "字数", value: wordTicker },
        { label: "新建时间", value: "刚刚" },
        { label: "最近更新", value: "刚刚" },
        { label: "所在知识库", value: kb?.name ?? "—" },
      ];

  return (
    <div className="flex h-full flex-col bg-transparent text-card-foreground">
      {/* 分段控件 */}
      <div className="p-3 pb-2">
        <div
          role="tablist"
          aria-label="信息面板"
          className="grid grid-cols-3 gap-1 rounded-full bg-foreground/[0.045] p-1"
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
                className="flex items-baseline justify-between gap-3 border-b border-border/50 py-2.5 last:border-b-0"
              >
                <dt className={cn(CAPTION_CLS, "shrink-0 text-muted-foreground")}>{label}</dt>
                <dd className="min-w-0 truncate text-right text-[13px] text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {tab === "backlinks" && (
          <EmptyState glyph="⛓" title="暂无反向链接" description="引用本文档后会显示在这里">
            <button
              type="button"
              onClick={onBackToInfo}
              className="cursor-default text-[13px] text-muted-foreground underline-offset-4 transition-colors duration-150 ease-[var(--ease)] hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              查看信息
            </button>
          </EmptyState>
        )}

        {tab === "related" &&
          (related.length === 0 ? (
            <EmptyState glyph="⛓" title="暂无推荐" />
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
      <div className="flex items-center gap-2 border-t border-border/50 px-4 py-3">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className={cn(CAPTION_CLS, "truncate text-muted-foreground")}>
          {kb?.name ?? "未命名知识库"} ·{" "}
          <NumberTicker value={node?.wordCount ?? 0} className="text-[12.5px]" /> 字
        </span>
      </div>
    </div>
  );
}
