//! 文档顶层块差量计划：内容寻址复用、LIS 锚点与 Fractional Index 最小重排。
//!
//! 输入变更前的块树缓存（id/hash/order）与最终 hash 序列，输出：
//! 最终块实例顺序、删除的旧实例、分段 order 变更；无法局部排序时整篇等距重排。

use std::collections::{HashMap, VecDeque};

use super::fractional_index::{generate_keys, rebalance_keys};

/// 变更前的块树行。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExistingBlock {
    pub id: String,
    pub hash: String,
    pub order: String,
}

/// 计划中的块实例。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedNode {
    pub id: String,
    pub hash: String,
    pub order: String,
    /// 旧 order；None 表示本次新增。
    pub old_order: Option<String>,
}

/// 一段连续重排的差量；`after`/`before` 为空表示头部/尾部。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedOrderChange {
    pub after: String,
    pub before: String,
    pub hash_list: Vec<String>,
}

/// 块差量计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockPlan {
    pub nodes: Vec<PlannedNode>,
    pub order_changes: Vec<PlannedOrderChange>,
    pub removed: Vec<ExistingBlock>,
    /// 是否触发整篇等距重排。
    pub rebalanced: bool,
}

struct Item {
    id: String,
    hash: String,
    old_index: Option<usize>,
    old_order: Option<String>,
    order: Option<String>,
}

/// 生成块计划；返回 None 表示排序空间耗尽（实际不会发生）。
///
/// `new_ids` 与 `hashes` 等长，为无法匹配旧实例时预生成的 UUID v7。
pub fn plan_blocks(
    existing: &[ExistingBlock],
    hashes: &[String],
    new_ids: &[String],
) -> Option<BlockPlan> {
    if hashes.len() != new_ids.len() {
        return None;
    }

    let mut queues: HashMap<&str, VecDeque<usize>> = HashMap::new();
    for (index, block) in existing.iter().enumerate() {
        queues
            .entry(block.hash.as_str())
            .or_default()
            .push_back(index);
    }

    let mut used = vec![false; existing.len()];
    let mut items = Vec::with_capacity(hashes.len());
    for (index, hash) in hashes.iter().enumerate() {
        let old_index = queues.get_mut(hash.as_str()).and_then(VecDeque::pop_front);
        if let Some(old_index) = old_index {
            used[old_index] = true;
        }
        items.push(Item {
            id: old_index
                .map(|old| existing[old].id.clone())
                .unwrap_or_else(|| new_ids[index].clone()),
            hash: hash.clone(),
            old_index,
            old_order: old_index.map(|old| existing[old].order.clone()),
            order: None,
        });
    }

    let removed: Vec<ExistingBlock> = existing
        .iter()
        .enumerate()
        .filter(|(index, _)| !used[*index])
        .map(|(_, block)| block.clone())
        .collect();

    if existing.is_empty() {
        return rebalance(items, removed);
    }

    let anchors = lis_anchor_indices(&items);
    if anchors.is_empty() {
        return rebalance(items, removed);
    }

    // LIS 锚点必须保持旧顺序递增，否则说明旧数据异常，直接全量重排。
    let mut previous_anchor_order: Option<&str> = None;
    for anchor in &anchors {
        let order = items[*anchor].old_order.as_deref()?;
        if previous_anchor_order.is_some_and(|previous| previous >= order) {
            return rebalance(items, removed);
        }
        previous_anchor_order = Some(order);
    }
    for anchor in &anchors {
        items[*anchor].order = items[*anchor].old_order.clone();
    }

    let mut order_changes = Vec::new();
    let mut cursor = 0usize;
    let mut previous_anchor: Option<usize> = None;
    for anchor in anchors.iter().copied().chain(std::iter::once(items.len())) {
        if cursor < anchor {
            let after = previous_anchor
                .and_then(|index| items[index].order.clone())
                .unwrap_or_default();
            let before = items
                .get(anchor)
                .and_then(|item| item.order.clone())
                .unwrap_or_default();
            let Some(keys) = generate_keys(anchor - cursor, &after, &before) else {
                return rebalance(items, removed);
            };
            let mut hash_list = Vec::with_capacity(keys.len());
            for (offset, key) in keys.into_iter().enumerate() {
                let index = cursor + offset;
                items[index].order = Some(key);
                hash_list.push(items[index].hash.clone());
            }
            order_changes.push(PlannedOrderChange {
                after,
                before,
                hash_list,
            });
        }
        if anchor < items.len() {
            previous_anchor = Some(anchor);
        }
        cursor = anchor + 1;
    }

    if !orders_are_strictly_increasing(&items) {
        return rebalance(items, removed);
    }

    finish(items, order_changes, removed, false)
}

/// 对保留块在最终序列中的旧位置求最长递增子序列，返回锚点所在的下标。
fn lis_anchor_indices(items: &[Item]) -> Vec<usize> {
    let mut tails: Vec<usize> = Vec::new();
    let mut previous: Vec<Option<usize>> = vec![None; items.len()];

    for (index, item) in items.iter().enumerate() {
        let Some(old_index) = item.old_index else {
            continue;
        };
        let position = tails.partition_point(|&tail| {
            items[tail]
                .old_index
                .is_some_and(|candidate| candidate < old_index)
        });
        if position > 0 {
            previous[index] = Some(tails[position - 1]);
        }
        if position == tails.len() {
            tails.push(index);
        } else {
            tails[position] = index;
        }
    }

    let mut anchors = Vec::with_capacity(tails.len());
    let mut current = tails.last().copied();
    while let Some(index) = current {
        anchors.push(index);
        current = previous[index];
    }
    anchors.reverse();
    anchors
}

fn orders_are_strictly_increasing(items: &[Item]) -> bool {
    let mut previous: Option<&str> = None;
    for item in items {
        let Some(order) = item.order.as_deref() else {
            return false;
        };
        if previous.is_some_and(|value| value >= order) {
            return false;
        }
        previous = Some(order);
    }
    true
}

/// 整篇等距重排；所有块都改为新键，输出覆盖全文的 order 变更。
fn rebalance(mut items: Vec<Item>, removed: Vec<ExistingBlock>) -> Option<BlockPlan> {
    let keys = rebalance_keys(items.len())?;
    for (item, key) in items.iter_mut().zip(keys) {
        item.order = Some(key);
    }
    let order_changes = if items.is_empty() {
        Vec::new()
    } else {
        vec![PlannedOrderChange {
            after: String::new(),
            before: String::new(),
            hash_list: items.iter().map(|item| item.hash.clone()).collect(),
        }]
    };
    finish(items, order_changes, removed, true)
}

fn finish(
    items: Vec<Item>,
    order_changes: Vec<PlannedOrderChange>,
    removed: Vec<ExistingBlock>,
    rebalanced: bool,
) -> Option<BlockPlan> {
    let nodes = items
        .into_iter()
        .map(|item| {
            Some(PlannedNode {
                id: item.id,
                hash: item.hash,
                order: item.order?,
                old_order: item.old_order,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(BlockPlan {
        nodes,
        order_changes,
        removed,
        rebalanced,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::fractional_index::MAX_ORDER_LEN;
    use std::collections::HashSet;

    fn existing(entries: &[(&str, &str, &str)]) -> Vec<ExistingBlock> {
        entries
            .iter()
            .map(|(id, hash, order)| ExistingBlock {
                id: (*id).to_string(),
                hash: (*hash).to_string(),
                order: (*order).to_string(),
            })
            .collect()
    }

    fn hashes(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    fn ids(count: usize) -> Vec<String> {
        (0..count).map(|index| format!("new-{index}")).collect()
    }

    fn assert_ordered(plan: &BlockPlan) {
        let orders: Vec<&str> = plan.nodes.iter().map(|node| node.order.as_str()).collect();
        for pair in orders.windows(2) {
            assert!(pair[0] < pair[1], "{} < {}", pair[0], pair[1]);
        }
        assert!(orders.iter().all(|order| order.len() <= MAX_ORDER_LEN));
    }

    #[test]
    fn first_save_rebalances_all_blocks() {
        let plan = plan_blocks(&[], &hashes(&["h1", "h2", "h3"]), &ids(3)).expect("首次保存");
        assert!(plan.rebalanced);
        assert_eq!(plan.nodes.len(), 3);
        assert_eq!(plan.order_changes.len(), 1);
        assert_eq!(plan.order_changes[0].hash_list, hashes(&["h1", "h2", "h3"]));
        assert!(plan.removed.is_empty());
        assert_ordered(&plan);
    }

    #[test]
    fn unchanged_document_keeps_instances_and_orders() {
        let old = existing(&[("i1", "h1", "a"), ("i2", "h2", "b"), ("i3", "h3", "c")]);
        let plan = plan_blocks(&old, &hashes(&["h1", "h2", "h3"]), &ids(3)).expect("计划");
        assert!(!plan.rebalanced);
        assert!(plan.order_changes.is_empty());
        assert!(plan.removed.is_empty());
        let node_ids: Vec<&str> = plan.nodes.iter().map(|node| node.id.as_str()).collect();
        assert_eq!(node_ids, vec!["i1", "i2", "i3"]);
        let orders: Vec<&str> = plan.nodes.iter().map(|node| node.order.as_str()).collect();
        assert_eq!(orders, vec!["a", "b", "c"]);
    }

    #[test]
    fn insertion_in_middle_reorders_only_new_block() {
        let old = existing(&[("i1", "h1", "a"), ("i2", "h2", "b"), ("i3", "h3", "c")]);
        let plan = plan_blocks(&old, &hashes(&["h1", "hx", "h2", "h3"]), &ids(4)).expect("计划");
        assert!(!plan.rebalanced);
        assert_eq!(plan.nodes[0].order, "a");
        assert_eq!(plan.nodes[2].order, "b");
        assert_eq!(plan.nodes[3].order, "c");
        assert_eq!(plan.nodes[1].id, "new-1");
        assert!(plan.nodes[1].order.as_str() > "a");
        assert!(plan.nodes[1].order.as_str() < "b");
        assert_eq!(
            plan.order_changes,
            vec![PlannedOrderChange {
                after: "a".to_string(),
                before: "b".to_string(),
                hash_list: hashes(&["hx"]),
            }]
        );
        assert_ordered(&plan);
    }

    #[test]
    fn deletion_keeps_remaining_orders() {
        let old = existing(&[("i1", "h1", "a"), ("i2", "h2", "b"), ("i3", "h3", "c")]);
        let plan = plan_blocks(&old, &hashes(&["h1", "h3"]), &ids(2)).expect("计划");
        assert!(!plan.rebalanced);
        assert!(plan.order_changes.is_empty());
        assert_eq!(plan.removed.len(), 1);
        assert_eq!(plan.removed[0].id, "i2");
        assert_eq!(plan.removed[0].hash, "h2");
        let orders: Vec<&str> = plan.nodes.iter().map(|node| node.order.as_str()).collect();
        assert_eq!(orders, vec!["a", "c"]);
    }

    #[test]
    fn moving_one_block_keeps_lis_anchors() {
        let old = existing(&[
            ("i1", "h1", "a"),
            ("i2", "h2", "b"),
            ("i3", "h3", "c"),
            ("i4", "h4", "d"),
        ]);
        let plan = plan_blocks(&old, &hashes(&["h4", "h1", "h2", "h3"]), &ids(4)).expect("计划");
        assert!(!plan.rebalanced);
        let by_hash: HashMap<&str, &PlannedNode> = plan
            .nodes
            .iter()
            .map(|node| (node.hash.as_str(), node))
            .collect();
        assert_eq!(by_hash["h1"].order, "a");
        assert_eq!(by_hash["h2"].order, "b");
        assert_eq!(by_hash["h3"].order, "c");
        assert!(by_hash["h4"].order.as_str() < "a");
        assert_eq!(plan.order_changes.len(), 1);
        assert_eq!(plan.order_changes[0].after, "");
        assert_eq!(plan.order_changes[0].before, "a");
        assert_eq!(plan.order_changes[0].hash_list, hashes(&["h4"]));
        assert_ordered(&plan);
    }

    #[test]
    fn duplicate_hashes_pair_instances_in_order() {
        let old = existing(&[("i1", "dup", "a"), ("i2", "dup", "b")]);
        let plan = plan_blocks(&old, &hashes(&["dup"]), &ids(1)).expect("计划");
        assert_eq!(plan.nodes.len(), 1);
        assert_eq!(plan.nodes[0].id, "i1");
        assert_eq!(plan.removed.len(), 1);
        assert_eq!(plan.removed[0].id, "i2");

        let plan = plan_blocks(&old, &hashes(&["dup", "dup"]), &ids(2)).expect("计划");
        let node_ids: Vec<&str> = plan.nodes.iter().map(|node| node.id.as_str()).collect();
        assert_eq!(node_ids, vec!["i1", "i2"]);
        let unique: HashSet<&str> = plan.nodes.iter().map(|node| node.id.as_str()).collect();
        assert_eq!(unique.len(), 2);
    }

    #[test]
    fn exhausted_between_keys_trigger_full_rebalance() {
        let left = "a".repeat(MAX_ORDER_LEN);
        let right = format!("{}b", "a".repeat(MAX_ORDER_LEN - 1));
        let old = existing(&[("i1", "h1", &left), ("i2", "h2", &right)]);
        let plan = plan_blocks(&old, &hashes(&["h1", "hx", "h2"]), &ids(3)).expect("全量重排兜底");
        assert!(plan.rebalanced);
        assert_eq!(plan.nodes[1].id, "new-1");
        assert_eq!(plan.order_changes.len(), 1);
        assert_eq!(plan.order_changes[0].after, "");
        assert_eq!(plan.order_changes[0].before, "");
        assert_ordered(&plan);
    }

    #[test]
    fn replacing_every_block_rebalances_and_removes_old() {
        let old = existing(&[("i1", "old1", "a"), ("i2", "old2", "b")]);
        let plan = plan_blocks(&old, &hashes(&["new1", "new2"]), &ids(2)).expect("计划");
        assert!(plan.rebalanced);
        assert_eq!(plan.removed.len(), 2);
        assert!(plan.nodes.iter().all(|node| node.id.starts_with("new-")));
        assert_ordered(&plan);
    }
}
