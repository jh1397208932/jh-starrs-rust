//! Fractional Index：base62 字典序排序键。
//!
//! 字母表 `0-9A-Za-z` 的字节序与字典序一致，因此 SQLite 直接按 TEXT 排序即可。
//! 键最大 32 字符；局部无法生成时返回 None，由调用方触发整篇等距重排。

/// 排序键字母表；顺序即字典序。
const ALPHABET: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/// 排序键最大长度（数据库字段设计上限）。
pub const MAX_ORDER_LEN: usize = 32;
/// 全量重排起始宽度；容量不足时逐位增加。
const REBALANCE_START_WIDTH: usize = 8;
/// u128 可容纳 base62 21 位（62^21 < 2^128），远超单文档块数的实际上限。
const REBALANCE_MAX_WIDTH: usize = 21;
/// 默认中位字符 `V` 的下标（62 / 2）。
const MID_INDEX: usize = 31;

/// 生成严格位于 `prev` 与 `next` 之间的键（两端可为 None）。
///
/// 返回 None 表示当前区间已无可用短键（如相邻键达到长度上限），
/// 调用方应执行全量重排；返回值保证满足 `prev < key < next` 且长度 ≤ 32。
pub fn key_between(prev: Option<&str>, next: Option<&str>) -> Option<String> {
    if let (Some(left), Some(right)) = (prev, next)
        && left >= right
    {
        return None;
    }
    let candidate = match (prev, next) {
        (None, None) => mid_char(MID_INDEX).to_string(),
        (None, Some(right)) => key_before(right)?,
        (Some(left), None) => key_after(left)?,
        (Some(left), Some(right)) => key_inside(left, right)?,
    };
    is_valid_key(&candidate, prev, next).then_some(candidate)
}

/// 生成 `count` 个递增键，全部落在 `(after, before)` 区间；任一失败即整体失败。
pub fn generate_keys(count: usize, after: &str, before: &str) -> Option<Vec<String>> {
    let mut keys = Vec::with_capacity(count);
    let mut cursor = if after.is_empty() {
        None
    } else {
        Some(after.to_string())
    };
    let upper = if before.is_empty() {
        None
    } else {
        Some(before)
    };
    for _ in 0..count {
        let key = key_between(cursor.as_deref(), upper)?;
        cursor = Some(key.clone());
        keys.push(key);
    }
    Some(keys)
}

/// 全量等距重排：为 `count` 个块生成固定宽度、严格递增的键。
///
/// 默认 8 位；当 `62^width / (count + 1)` 为 0 时增加宽度。实际文档规模下
/// 8 位即可容纳数万亿块，宽度上限由 u128 决定（21 位）。
pub fn rebalance_keys(count: usize) -> Option<Vec<String>> {
    if count == 0 {
        return Some(Vec::new());
    }
    let count_u128 = u128::try_from(count).ok()?;
    let slots = count_u128.checked_add(1)?;
    for width in REBALANCE_START_WIDTH..=REBALANCE_MAX_WIDTH {
        let capacity = 62u128.checked_pow(u32::try_from(width).ok()?)?;
        let step = capacity / slots;
        if step == 0 {
            continue;
        }
        let mut keys = Vec::with_capacity(count);
        for index in 1..=count_u128 {
            let value = step.checked_mul(index)?;
            if value == 0 || value >= capacity {
                return None;
            }
            keys.push(encode_base62(value, width));
        }
        let ordered = keys
            .windows(2)
            .all(|pair| pair[0] < pair[1] && pair[0].len() <= MAX_ORDER_LEN);
        if ordered {
            return Some(keys);
        }
    }
    None
}

/// 生成小于 `next` 的键：找到第一个大于 `0` 的字符，在其前半区取中位值。
fn key_before(next: &str) -> Option<String> {
    let bytes = next.as_bytes();
    for (position, byte) in bytes.iter().enumerate() {
        let index = alphabet_index(*byte)?;
        if index > 0 {
            let mut candidate = String::with_capacity(position + 1);
            candidate.push_str(&next[..position]);
            candidate.push(mid_char(index / 2));
            return Some(candidate);
        }
    }
    None
}

/// 生成大于 `prev` 的键：优先末位递增，无法递增时向右追加中位字符。
fn key_after(prev: &str) -> Option<String> {
    let bytes = prev.as_bytes();
    for position in (0..bytes.len()).rev() {
        let index = alphabet_index(bytes[position])?;
        if index + 1 < ALPHABET.len() {
            let mut candidate = String::with_capacity(position + 1);
            candidate.push_str(&prev[..position]);
            candidate.push(mid_char(index + 1));
            return Some(candidate);
        }
    }
    if prev.len() < MAX_ORDER_LEN {
        let mut candidate = prev.to_string();
        candidate.push(mid_char(MID_INDEX));
        Some(candidate)
    } else {
        None
    }
}

/// 生成严格位于 `left` 与 `right` 之间的键。
fn key_inside(left: &str, right: &str) -> Option<String> {
    let left_bytes = left.as_bytes();
    let right_bytes = right.as_bytes();
    let mut common = 0;
    while common < left_bytes.len()
        && common < right_bytes.len()
        && left_bytes[common] == right_bytes[common]
    {
        common += 1;
    }

    if common == left_bytes.len() {
        // left 是 right 的前缀：在 right 的下一位前取中位；下一位为 0 时无解。
        let next_index = alphabet_index(*right_bytes.get(common)?)?;
        if next_index == 0 {
            return None;
        }
        let mut candidate = String::with_capacity(common + 1);
        candidate.push_str(&left[..common]);
        candidate.push(mid_char(next_index / 2));
        return Some(candidate);
    }

    let left_index = alphabet_index(*left_bytes.get(common)?)?;
    let right_index = alphabet_index(*right_bytes.get(common)?)?;
    if right_index.saturating_sub(left_index) > 1 {
        let mut candidate = String::with_capacity(common + 1);
        candidate.push_str(&left[..common]);
        candidate.push(mid_char((left_index + right_index) / 2));
        return Some(candidate);
    }

    // 相邻字符：在 left 后追加中位字符，因首位差异仍小于 right。
    if left.len() >= MAX_ORDER_LEN {
        return None;
    }
    let mut candidate = String::with_capacity(left.len() + 1);
    candidate.push_str(left);
    candidate.push(mid_char(MID_INDEX));
    Some(candidate)
}

/// 固定宽度 base62 编码（左侧补 `0`）。
fn encode_base62(mut value: u128, width: usize) -> String {
    let mut buffer = vec![b'0'; width];
    for position in (0..width).rev() {
        buffer[position] = ALPHABET[(value % 62) as usize];
        value /= 62;
    }
    String::from_utf8(buffer).expect("base62 字母表为 ASCII")
}

fn alphabet_index(byte: u8) -> Option<usize> {
    ALPHABET.iter().position(|candidate| *candidate == byte)
}

fn mid_char(index: usize) -> char {
    ALPHABET[index] as char
}

/// 校验候选键的字符集、长度与区间约束。
fn is_valid_key(candidate: &str, prev: Option<&str>, next: Option<&str>) -> bool {
    if candidate.is_empty()
        || candidate.len() > MAX_ORDER_LEN
        || !candidate.bytes().all(|byte| alphabet_index(byte).is_some())
    {
        return false;
    }
    if prev.is_some_and(|left| left >= candidate) {
        return false;
    }
    if next.is_some_and(|right| candidate >= right) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_between(prev: Option<&str>, next: Option<&str>) -> String {
        let key = key_between(prev, next).expect("区间应可生成键");
        if let Some(left) = prev {
            assert!(left < key.as_str(), "{left} < {key}");
        }
        if let Some(right) = next {
            assert!(key.as_str() < right, "{key} < {right}");
        }
        assert!(key.len() <= MAX_ORDER_LEN);
        assert!(key.bytes().all(|byte| alphabet_index(byte).is_some()));
        key
    }

    #[test]
    fn key_between_covers_head_middle_and_tail() {
        let head = assert_between(None, Some("a"));
        assert!(head.as_str() < "a");
        let middle = assert_between(Some("a"), Some("b"));
        assert!(middle.as_str() > "a");
        let wide = assert_between(Some("ab"), Some("ac"));
        assert_eq!(wide.len(), 3);
        let tail = assert_between(Some("z"), None);
        assert!(tail.as_str() > "z");
    }

    #[test]
    fn repeated_middle_inserts_grow_until_limit() {
        let mut left = "a".to_string();
        let right = "b".to_string();
        let mut produced = 0usize;
        while let Some(key) = key_between(Some(&left), Some(&right)) {
            assert!(key.as_str() < right.as_str());
            left = key;
            produced += 1;
            assert!(produced < 1000, "必须在长度上限前终止");
        }
        assert_eq!(produced, MAX_ORDER_LEN - 1, "a 后最多再放 31 个中位键");
    }

    #[test]
    fn invalid_or_full_ranges_return_none() {
        assert!(key_between(Some("b"), Some("a")).is_none());
        assert!(key_between(Some("a"), Some("a")).is_none());
        assert!(key_between(None, Some("0")).is_none());
        assert!(key_between(Some(&"z".repeat(MAX_ORDER_LEN)), None).is_none());
    }

    #[test]
    fn rebalance_is_even_unique_and_ascending() {
        let keys = rebalance_keys(1000).expect("1000 块可重排");
        assert_eq!(keys.len(), 1000);
        assert!(keys.iter().all(|key| key.len() == 8));
        for pair in keys.windows(2) {
            assert!(pair[0] < pair[1], "{} < {}", pair[0], pair[1]);
        }
        let unique: std::collections::HashSet<_> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len());
        assert!(rebalance_keys(0).unwrap().is_empty());
    }

    #[test]
    fn generated_run_stays_between_anchors() {
        let keys = generate_keys(5, "a", "b").expect("区间足够");
        assert!(keys[0].as_str() > "a");
        assert!(keys.last().unwrap().as_str() < "b");
        for pair in keys.windows(2) {
            assert!(pair[0] < pair[1]);
        }
    }
}
