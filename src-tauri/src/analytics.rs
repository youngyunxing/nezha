// ── Session metrics ───────────────────────────────────────────────────────────

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::HashMap;
use std::time::SystemTime;

#[derive(serde::Serialize, Clone, Default)]
pub(crate) struct SessionMetrics {
    pub(crate) tool_calls: u64,
    pub(crate) duration_secs: f64,
    pub(crate) session_file_bytes: u64,
    /// 任务累计 token 消耗（包含缓存命中 / reasoning），用于 UI"总消耗"。
    pub(crate) total_tokens: u64,
    /// 当前上下文占用（最后一轮 prompt 大小）。Codex 直读，Claude 由最后一条 assistant 推导。
    pub(crate) context_tokens: u64,
    /// 模型上下文窗口大小。仅 Codex 自带；Claude session 不暴露此值，留 0 让前端隐藏。
    pub(crate) context_window: u64,
    /// 当前速度（输出 token/秒）。只算输出 —— 输入里绝大多数是缓存命中，算进去就不是
    /// 「生成速度」了。走了 cc-switch 代理的会话直接用代理库里的真实生成速度
    /// （output / (latency − ttft)，最近一次请求）；没有代理日志才退回 transcript 估算。
    pub(crate) tps_current: f64,
    /// 过去 5 小时的平均速度。有代理日志时 = 窗口内 Σoutput / Σ(latency − ttft)；
    /// 退回 transcript 估算时 = 输出 token / 有效生成时长（间隔 ≤20 秒的部分，排掉发呆和跑工具）。
    pub(crate) tps_5h: f64,
    /// 会话最后一次活动的时间（epoch 秒）。前端用它判断「最近没动静」→ 当前速度显示 0。
    pub(crate) last_activity_ts: f64,
}

/// 相邻记录间隔超过这个秒数就不算在「生成中」（跑工具、发呆都排掉）。
const ACTIVE_GAP_MAX_SECS: f64 = 20.0;

/// 当前速度：窗口内输出 token / 窗口长度。窗口按「最后一次活动」对齐，这样同一次生成
/// 反复读出来的值稳定；空闲时由前端（看 last_activity_ts）显示 0。
fn window_rate(samples: &[(f64, u64)], end: f64, window_secs: f64) -> f64 {
    if end <= 0.0 {
        return 0.0;
    }
    let start = end - window_secs;
    let tokens: u64 = samples
        .iter()
        .filter(|(ts, _)| *ts >= start && *ts <= end)
        .map(|(_, out)| *out)
        .sum();
    tokens as f64 / window_secs
}

/// 生成时的平均速度：窗口内输出 token / 有效生成时长（相邻记录间隔 ≤20 秒的部分）。
/// 这样既不被发呆时间稀释，也不会因为几条写入挤在一起而爆炸。
fn active_rate(samples: &[(f64, u64)], end: f64, window_secs: f64) -> f64 {
    let start = end - window_secs;
    let in_window: Vec<&(f64, u64)> = samples
        .iter()
        .filter(|(ts, _)| *ts >= start && *ts <= end)
        .collect();
    if in_window.len() < 2 {
        return 0.0;
    }
    let tokens: u64 = in_window.iter().map(|(_, out)| *out).sum();
    let active: f64 = in_window
        .windows(2)
        .map(|pair| (pair[1].0 - pair[0].0).min(ACTIVE_GAP_MAX_SECS))
        .sum();
    if active < 1.0 {
        return 0.0;
    }
    tokens as f64 / active
}

/// cc-switch 本地代理日志是现在唯一能拿到「真实生成速度」的地方：
/// transcript 只有落盘时间戳（CLI 是流式结束后批量写入，写入跨度只有真实耗时的零头），
/// 代理库却逐请求记了 output_tokens / latency_ms / first_token_ms，而且它的 session_id
/// 就是 Claude Code 的会话 UUID。口径跟 cc-switch 保持一致：生成速度 = output / (latency − ttft)。
const CCSWITCH_DB_REL: &str = ".cc-switch/cc-switch.db";
/// 生成耗时太短的样本（首字刚出就收尾）会算出离谱的值，直接不算。
const CCSWITCH_MIN_GEN_MS: i64 = 200;

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// 查 cc-switch 代理库，返回 (当前速度, 5 小时平均速度)。
/// 查不到（没装 / 这轮没走代理 / 该会话没有记录）返回 None，由调用方退回 transcript 估算。
fn ccswitch_tps(session_id: &str) -> Option<(f64, f64)> {
    if !is_uuid(session_id) {
        return None; // 只放行 UUID，顺便杜绝拼进 SQL
    }
    let home = std::env::var_os("HOME")?;
    let db = std::path::Path::new(&home).join(CCSWITCH_DB_REL);
    if !db.is_file() {
        return None;
    }
    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs() as i64;
    let gen_ms = "(latency_ms-coalesce(first_token_ms,0))";
    let filter = format!(
        "session_id='{session_id}' and output_tokens>0 and {gen_ms}>{CCSWITCH_MIN_GEN_MS}"
    );
    let sql = format!(
        "select ifnull((select round(output_tokens*1000.0/{gen_ms},1) from proxy_request_logs \
           where {filter} order by created_at desc limit 1),0), \
         ifnull((select round(sum(output_tokens)*1000.0/sum({gen_ms}),1) from proxy_request_logs \
           where {filter} and created_at>={since}),0);",
        since = now - 5 * 3600
    );
    let out = std::process::Command::new("/usr/bin/sqlite3")
        .args(["-noheader", "-separator", "|", "-cmd", ".timeout 1500"])
        .arg(&db)
        .arg(&sql)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.trim().split('|');
    let current: f64 = parts.next()?.trim().parse().ok()?;
    let five_h: f64 = parts.next()?.trim().parse().ok()?;
    if current <= 0.0 && five_h <= 0.0 {
        return None;
    }
    Some((current, five_h))
}

/// 缓存：session_path → (file_modified_time, SessionMetrics)
static METRICS_CACHE: Lazy<Mutex<HashMap<String, (SystemTime, SessionMetrics)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn parse_rfc3339_secs(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp() as f64 + dt.timestamp_subsec_millis() as f64 / 1000.0)
}

fn track_timestamp(val: &Value, first: &mut Option<f64>, last: &mut Option<f64>) {
    if let Some(ts_str) = val.get("timestamp").and_then(|v| v.as_str()) {
        if let Some(ts) = parse_rfc3339_secs(ts_str) {
            if first.is_none() {
                *first = Some(ts);
            }
            *last = Some(ts);
        }
    }
}

fn duration_from(first: Option<f64>, last: Option<f64>) -> f64 {
    match (first, last) {
        (Some(a), Some(b)) => (b - a).max(0.0),
        _ => 0.0,
    }
}

/// 探测格式：与 `session.rs::is_codex_format` 保持一致——前 10 行内出现
/// `type=session_meta` 或 `type=event_msg` 即视为 Codex。
/// Why: Codex 各版本 `payload.originator` 取值漂移（codex_cli_rs / codex-tui / ...），
/// 仅靠 originator 前缀判定会让部分可正常回放的 Codex session 被错走 Claude 解析，
/// token/tool_calls 全部归零；判定标准必须与会话查看器保持一致。
fn is_codex_session(content: &str) -> bool {
    for line in content.lines().take(10) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session_meta") | Some("event_msg") => return true,
            _ => {}
        }
    }
    false
}

fn parse_claude_metrics(content: &str) -> SessionMetrics {
    /// 一条 assistant message 的累计用量。同一条 message 会被写成多行 JSONL，且每行都带
    /// 同一份 usage —— 必须按 message.id 去重，否则 token 总量与 TPS 会成倍虚高
    /// （实测某会话逐行相加比真实值高 2.1 倍）。
    struct MessageUsage {
        ts: f64,
        input: u64,
        output: u64,
        cache_creation: u64,
        cache_read: u64,
    }

    let mut tool_calls: u64 = 0;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;
    let mut by_message: HashMap<String, MessageUsage> = HashMap::new();

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        track_timestamp(&val, &mut first_ts, &mut last_ts);

        if val.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let Some(message) = val.get("message") else {
            continue;
        };

        // tool_use 块每条只出现在一行里，不需要去重
        if let Some(arr) = message.get("content").and_then(|v| v.as_array()) {
            for item in arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    tool_calls += 1;
                }
            }
        }

        let Some(usage) = message.get("usage") else {
            continue;
        };
        let Some(ts) = val
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(parse_rfc3339_secs)
        else {
            continue;
        };
        // 极少数没有 message.id 的记录，用时间戳当键（各自独立、不会被误合并）
        let key = message
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("ts:{ts}"));

        let entry = by_message.entry(key).or_insert(MessageUsage {
            ts,
            input: 0,
            output: 0,
            cache_creation: 0,
            cache_read: 0,
        });
        entry.ts = ts;
        entry.input = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        entry.output = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        entry.cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        entry.cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
    }

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation: u64 = 0;
    let mut cache_read: u64 = 0;
    let mut last_context: u64 = 0;
    let mut last_context_ts = f64::NEG_INFINITY;
    let mut samples: Vec<(f64, u64)> = Vec::with_capacity(by_message.len());
    for usage in by_message.values() {
        input_tokens += usage.input;
        output_tokens += usage.output;
        cache_creation += usage.cache_creation;
        cache_read += usage.cache_read;
        samples.push((usage.ts, usage.output));
        // 最后一条 assistant 的 prompt 总大小 ≈ 当前上下文占用
        if usage.ts >= last_context_ts {
            last_context_ts = usage.ts;
            last_context = usage.input + usage.cache_creation + usage.cache_read;
        }
    }
    samples.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let end = last_ts.unwrap_or(0.0);
    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens: input_tokens + output_tokens + cache_creation + cache_read,
        context_tokens: last_context,
        context_window: 0, // Claude session 不带窗口大小
        tps_current: window_rate(&samples, end, 60.0),
        tps_5h: active_rate(&samples, end, 5.0 * 3600.0),
        last_activity_ts: end,
    }
}

fn parse_codex_metrics(content: &str) -> SessionMetrics {
    let mut tool_calls: u64 = 0;
    let mut last_token_info: Option<Value> = None;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else { continue };
        track_timestamp(&val, &mut first_ts, &mut last_ts);

        let t = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = val.get("payload");
        let pt = payload
            .and_then(|p| p.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match (t, pt) {
            ("event_msg", "token_count") => {
                if let Some(info) = payload.and_then(|p| p.get("info")) {
                    if !info.is_null() {
                        last_token_info = Some(info.clone());
                    }
                }
            }
            ("response_item", "function_call") | ("response_item", "custom_tool_call") => {
                tool_calls += 1;
            }
            _ => {}
        }
    }

    let (total_tokens, context_tokens, context_window) =
        if let Some(info) = last_token_info.as_ref() {
            let total = info.get("total_token_usage");
            let last = info.get("last_token_usage");
            let tot = total
                .and_then(|t| t.get("total_tokens"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let ctx = last
                .and_then(|l| l.get("total_tokens"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let win = info
                .get("model_context_window")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (tot, ctx, win)
        } else {
            (0, 0, 0)
        };

    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens,
        context_tokens,
        context_window,
        // Codex 的事件流里没有逐条 output token，先不给 TPS（前端两值都为 0 时不显示）
        tps_current: 0.0,
        tps_5h: 0.0,
        last_activity_ts: last_ts.unwrap_or(0.0),
    }
}

pub(crate) fn parse_session_metrics_from_path(path: &std::path::Path) -> SessionMetrics {
    let Ok(content) = std::fs::read_to_string(path) else {
        return SessionMetrics::default();
    };
    let session_file_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut metrics = if is_codex_session(&content) {
        parse_codex_metrics(&content)
    } else {
        parse_claude_metrics(&content)
    };
    metrics.session_file_bytes = session_file_bytes;
    metrics
}

/// 带缓存的 session 指标解析
/// 通过文件修改时间判断缓存是否有效，避免重复解析未变更的文件
pub(crate) fn parse_session_metrics_cached(path: &std::path::Path) -> SessionMetrics {
    let path_str = path.to_string_lossy().to_string();

    // 获取文件修改时间
    let modified = match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return SessionMetrics::default(),
    };

    // 检查缓存
    {
        let cache = METRICS_CACHE.lock();
        if let Some((cached_time, cached_metrics)) = cache.get(&path_str) {
            if *cached_time == modified {
                return cached_metrics.clone();
            }
        }
    }

    // 缓存未命中，完整解析
    let metrics = parse_session_metrics_from_path(path);

    // 更新缓存
    {
        let mut cache = METRICS_CACHE.lock();
        cache.insert(path_str, (modified, metrics.clone()));
    }

    metrics
}

#[tauri::command]
pub async fn read_session_metrics(session_path: String) -> Result<SessionMetrics, String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&session_path);
        if !path.exists() {
            return Err(format!("Session file not found: {}", session_path));
        }
        let mut metrics = parse_session_metrics_cached(path);
        // 走 cc-switch 代理的会话，用代理库里的真实生成速度盖掉 transcript 的估算。
        if let Some(session_id) = path.file_stem().and_then(|s| s.to_str()) {
            if let Some((current, five_h)) = ccswitch_tps(session_id) {
                metrics.tps_current = current;
                metrics.tps_5h = five_h;
            }
        }
        Ok(metrics)
    })
    .await
    .map_err(|e| format!("read_session_metrics join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ccswitch_tps_only_accepts_uuid() {
        assert!(is_uuid("781927e0-3296-4763-8211-a456871c84a8"));
        assert!(!is_uuid("rollout-2026-09-29T12-00-00-781927e0")); // Codex 的 rollout 文件名
        assert!(!is_uuid("781927e0' or '1'='1"));
        assert!(!is_uuid(""));
    }
}
