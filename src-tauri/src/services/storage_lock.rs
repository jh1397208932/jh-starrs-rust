//! 每工作区的进程内存储锁。
//!
//! 只包住物理发布/追加/删除/compaction 提交等临界区；哈希与复制在锁外进行。
//! 锁按 workspace id 共享，切换工作区后再次打开同一工作区仍复用同一把锁。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

type LockMap = HashMap<String, Weak<Mutex<()>>>;

static LOCKS: OnceLock<Mutex<LockMap>> = OnceLock::new();

/// 取得某工作区的存储锁；没有活跃引用时自动回收。
pub fn lock_for(workspace_id: &str) -> Arc<Mutex<()>> {
    let registry = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = match registry.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(existing) = map.get(workspace_id).and_then(Weak::upgrade) {
        return existing;
    }
    let lock = Arc::new(Mutex::new(()));
    map.insert(workspace_id.to_string(), Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_workspace_shares_lock_and_drops_weak_entry() {
        let first = lock_for("ws-lock-test");
        let second = lock_for("ws-lock-test");
        assert!(Arc::ptr_eq(&first, &second));

        drop(first);
        drop(second);
        let third = lock_for("ws-lock-test");
        assert!(!Arc::ptr_eq(&third, &lock_for("other-ws")));
    }
}
