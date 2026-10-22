//! 无业务归属的通用工具。

use chrono::Utc;
use uuid::Uuid;

/// 当前 Unix 毫秒时间戳；所有表的时间列统一用毫秒整数。
pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

/// 生成时间有序的 UUID v7，所有主键统一使用。
pub fn new_id() -> String {
    Uuid::now_v7().to_string()
}
