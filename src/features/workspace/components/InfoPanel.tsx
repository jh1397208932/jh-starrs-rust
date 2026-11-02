import { memo, type ReactNode, useEffect, useState } from "react";
import { getNodeNetwork } from "@/api/search";
import { MagicCard } from "@/components/common/motion/MagicCard";
import { NumberTicker } from "@/components/common/motion/NumberTicker";
import { EmptyState } from "@/components/ui/empty-state";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatTimestamp } from "@/features/workspace/utils/tree";
import { useI18n } from "@/lib/i18n";
import { CAPTION_CLS, cn } from "@/lib/utils";
import type { KnowledgeBase, NodeItem } from "@/types/notebook";
import type { NetworkItem } from "@/types/search";

export interface InfoPanelProps {
  node: NodeItem | null;
  kb: KnowledgeBase | null;
  onBackToInfo: () => void;
  /** 打开网络条目对应的节点 */
  onOpenNode: (id: string) => void;
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
export const InfoPanel = memo(function InfoPanel({ node, kb, onBackToInfo, onOpenNode }: InfoPanelProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<InfoTab>("info");
  const [backlinks, setBacklinks] = useState<NetworkItem[]>([]);
  const [related, setRelated] = useState<NetworkItem[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const nodeId = node?.id;
  const nodeUpdatedAt = node?.updatedAt;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 保存后 updatedAt 变化需要重新读取知识网络
  useEffect(() => {
    if (!nodeId) {
      setBacklinks([]);
      setRelated([]);
      return;
    }
    let active = true;
    setNetworkLoading(true);
    getNodeNetwork(nodeId)
      .then((network) => {
        if (!active) return;
        setBacklinks(network.backlinks);
        setRelated(network.related);
      })
      .catch(() => {
        if (!active) return;
        setBacklinks([]);
        setRelated([]);
      })
      .finally(() => {
        if (active) setNetworkLoading(false);
      });
    return () => {
      active = false;
    };
  }, [nodeId, nodeUpdatedAt]);

  const wordTicker = (
    <NumberTicker value={node?.wordCount ?? 0} className="text-[13px] font-medium text-foreground" />
  );

  const fields: FieldRow[] = node
    ? [
        { label: t("字数"), value: wordTicker },
        { label: t("新建时间"), value: formatTimestamp(node.createdAt) },
        { label: t("最近更新"), value: formatTimestamp(node.updatedAt) },
        { label: t("所在知识库"), value: kb?.name ?? "—" },
      ]
    : [
        { label: t("字数"), value: wordTicker },
        { label: t("新建时间"), value: t("刚刚") },
        { label: t("最近更新"), value: t("刚刚") },
        { label: t("所在知识库"), value: kb?.name ?? "—" },
      ];

  return (
    <div className="flex h-full flex-col bg-transparent text-card-foreground">
      {/* 分段控件 */}
      <div className="p-3 pb-2">
        <div
          role="tablist"
          aria-label={t("信息面板")}
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
                "cursor-default rounded-full py-1 text-[12.5px] transition-[background-color,box-shadow,color] duration-150 ease-[var(--ease)]",
                tab === id
                  ? "bg-card font-[650] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(label)}
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

        {tab === "backlinks" &&
          (backlinks.length === 0 ? (
            <EmptyState
              glyph="⛓"
              title={networkLoading ? t("正在读取…") : t("暂无反向链接")}
              description={t("其他文档在正文提到本文标题后，会显示在这里")}
            >
              <button
                type="button"
                onClick={onBackToInfo}
                className="cursor-default text-[13px] text-muted-foreground underline-offset-4 transition-colors duration-150 ease-[var(--ease)] hover:text-foreground hover:underline"
              >
                {t("查看信息")}
              </button>
            </EmptyState>
          ) : (
            <ul aria-label={t("反向链接列表")} className="flex flex-col gap-1.5">
              {backlinks.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={t("打开 {title}", { title: item.title })}
                    onClick={() => onOpenNode(item.id)}
                    className="w-full cursor-default rounded-lg border border-border/60 px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease)] hover:bg-accent/40"
                  >
                    <span className="block truncate text-[13px] text-foreground">{item.title}</span>
                    <span className={cn(CAPTION_CLS, "block text-muted-foreground")}>{item.kbName}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {tab === "related" &&
          (related.length === 0 ? (
            <EmptyState glyph="⛓" title={networkLoading ? t("正在读取…") : t("暂无推荐")} />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {related.map((item) => (
                <li key={item.id}>
                  <MagicCard className="rounded-lg" gradientSize={140} gradientOpacity={0.5}>
                    <button
                      type="button"
                      aria-label={t("打开 {title}", { title: item.title })}
                      onClick={() => onOpenNode(item.id)}
                      className="w-full cursor-default rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ease-[var(--ease)]"
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
          {kb?.name ?? t("未命名知识库")} ·{" "}
          <NumberTicker value={node?.wordCount ?? 0} className="text-[12.5px]" /> {t("字")}
        </span>
      </div>
    </div>
  );
});
