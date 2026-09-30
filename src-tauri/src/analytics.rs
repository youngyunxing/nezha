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
    /// 当前速度（输出 token/秒）= 最近一条 assistant 消息的输出 token ÷ 它的生成窗口。
    /// 只算输出 —— 输入里绝大多数是缓存命中，算进去就不是「生成速度」了。
    pub(crate) tps_current: f64,
    /// 过去 5 小时的平均速度 = 窗口内 Σ输出 token ÷ Σ生成窗口。
    pub(crate) tps_5h: f64,
    /// 会话最后一次活动的时间（epoch 秒）。前端用它判断「最近没动静」→ 当前速度显示 0。
    pub(crate) last_activity_ts: f64,
}

/// TPS 全部从会话文件自算，不依赖任何外部程序。
///
/// 生成窗口 = (前一条 user 记录的落盘时间, 这条消息最后一行的落盘时间]。
/// 为什么这两点之间就是生成时间：
///   - CLI 每写完一个内容块追一行 JSONL（thinking → text → tool_use），最后一行的时间戳
///     就是这一轮生成结束的时刻；
///   - 工具是在 tool_result 落盘之前跑完的，而 tool_result 也是 user 记录，所以拿它当起点
///     天然把工具执行时间排除在外（实测某轮 tool_use 11.253 → tool_result 11.680，
///     工具耗时 0.43 秒不会被算进生成）。
/// 代价：窗口里含首字等待（上游排队 + 预填充）和 CLI 自身开销，所以这是「整轮吞吐」，
/// 比纯生成速度低一档 —— 会话文件里没有逐请求的 ttft/latency，算不出更细的。
const TPS_WINDOW_SECS: f64 = 5.0 * 3600.0;
/// 窗口短于这个值多半是生成中用户又插了一条消息把窗口截断，不算。
const TPS_MIN_WINDOW_SECS: f64 = 0.2;
/// 速率超过这个上限说明窗口残缺（真实生成速度远低于此），丢掉不污染平均。
const TPS_MAX_PLAUSIBLE: f64 = 400.0;

/// 一条 assistant 消息的生成样本。
struct TpsSample {
    end: f64,
    tokens: u64,
    window: f64,
}

impl TpsSample {
    fn rate(&self) -> f64 {
        self.tokens as f64 / self.window
    }
}

/// 最近一条消息的速度；窗口内没有任何样本时返回 0（前端会再按空闲时间衰减）。
fn current_rate(samples: &[TpsSample]) -> f64 {
    samples.last().map(TpsSample::rate).unwrap_or(0.0)
}

/// 窗口内的平均速度：Σtoken ÷ Σ窗口。按总量聚合比逐条平均稳，
/// 一条极快或极慢的消息不会把结果带偏。
fn aggregate_rate(samples: &[TpsSample], end: f64) -> f64 {
    if end <= 0.0 {
        return 0.0;
    }
    let start = end - TPS_WINDOW_SECS;
    let (tokens, window) = samples
        .iter()
        .filter(|s| s.end >= start && s.end <= end)
        .fold((0u64, 0.0), |(t, w), s| (t + s.tokens, w + s.window));
    if window < 1.0 {
        return 0.0;
    }
    tokens as f64 / window
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

/// 探测 Kimi Code 的 wire.jsonl：与 `session.rs::is_kimi_format` 保持一致 ——
/// 首行 `metadata` 带 `protocol_version`，或事件流里出现 `turn.prompt`。
fn is_kimi_session(content: &str) -> bool {
    for line in content.lines().take(10) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("metadata") if v.get("protocol_version").is_some() => return true,
            Some("turn.prompt") | Some("context.append_loop_event") => return true,
            _ => {}
        }
    }
    false
}

/// kimi 的 token 账本在 wire 里的 `usage.record`（每步一条）：
/// `{inputOther, output, inputCacheRead, inputCacheCreation}`，四项都算进总消耗。
/// `usageScope == "session"` 的是**累计值**，算了会重复计，跳过。
///
/// TPS 比 Claude 那边准：`step.end` 直接带 `llmFirstTokenLatencyMs` + `llmStreamDurationMs`，
/// 不用靠"前一条 user 记录"反推窗口。口径与 Claude 对齐 —— 窗口含首字等待（整轮吞吐），
/// 不是纯解码速度。
fn parse_kimi_metrics(content: &str) -> SessionMetrics {
    let mut tool_calls: u64 = 0;
    let mut total_tokens: u64 = 0;
    let mut last_usage: Option<Value> = None;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;
    let mut samples: Vec<TpsSample> = Vec::new();

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else { continue };
        let ts = val.get("time").and_then(|v| v.as_i64()).map(|ms| ms as f64 / 1000.0);
        if let Some(ts) = ts {
            if first_ts.is_none() {
                first_ts = Some(ts);
            }
            last_ts = Some(ts);
        }

        match val.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "usage.record" => {
                if val.get("usageScope").and_then(|v| v.as_str()) == Some("session") {
                    continue;
                }
                let Some(usage) = val.get("usage") else { continue };
                total_tokens += kimi_usage_total(usage);
                last_usage = Some(usage.clone());
            }
            "context.append_loop_event" => {
                let Some(event) = val.get("event") else { continue };
                match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "tool.call" => tool_calls += 1,
                    "step.end" => {
                        let Some(end) = ts else { continue };
                        let output = event
                            .get("usage")
                            .and_then(|u| u.get("output"))
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let ttft = event
                            .get("llmFirstTokenLatencyMs")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let stream = event
                            .get("llmStreamDurationMs")
                            .and_then(|v| v.as_f64())
                            .unwrap_or(0.0);
                        let window = (ttft + stream) / 1000.0;
                        if output == 0 || window < TPS_MIN_WINDOW_SECS {
                            continue;
                        }
                        let sample = TpsSample { end, tokens: output, window };
                        if sample.rate() > TPS_MAX_PLAUSIBLE {
                            continue;
                        }
                        samples.push(sample);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    let end = last_ts.unwrap_or(0.0);
    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens,
        // 上下文占用 = 最后一步的 prompt 大小（缓存命中算在内，它就是实际喂进去的量）
        context_tokens: last_usage.as_ref().map(kimi_context_tokens).unwrap_or(0),
        context_window: 0, // kimi 不暴露窗口大小，留 0 让前端隐藏
        tps_current: current_rate(&samples),
        tps_5h: aggregate_rate(&samples, end),
        last_activity_ts: end,
    }
}

/// 四项全算：kimi 的 `inputOther` 是非缓存输入、`inputCacheRead` 是命中缓存的输入。
fn kimi_usage_total(usage: &Value) -> u64 {
    ["inputOther", "output", "inputCacheRead", "inputCacheCreation"]
        .iter()
        .filter_map(|k| usage.get(*k).and_then(|v| v.as_u64()))
        .sum()
}

/// 上下文占用不含 output：输出是这一轮新产生的，不是"占着窗口的存量"。
fn kimi_context_tokens(usage: &Value) -> u64 {
    ["inputOther", "inputCacheRead", "inputCacheCreation"]
        .iter()
        .filter_map(|k| usage.get(*k).and_then(|v| v.as_u64()))
        .sum()
}

fn parse_claude_metrics(content: &str) -> SessionMetrics {
    /// 一条 assistant message 的累计用量。同一条 message 会被写成多行 JSONL，且每行都带
    /// 同一份 usage —— 必须按 message.id 去重，否则 token 总量与 TPS 会成倍虚高
    /// （实测某会话逐行相加比真实值高 2.1 倍）。
    struct MessageUsage {
        first: f64,
        last: f64,
        input: u64,
        output: u64,
        cache_creation: u64,
        cache_read: u64,
    }

    let mut tool_calls: u64 = 0;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;
    let mut by_message: HashMap<String, MessageUsage> = HashMap::new();
    // user 记录的落盘时间（提示词、工具结果、斜杠命令都算）—— 生成的起点
    let mut prompts: Vec<f64> = Vec::new();

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        track_timestamp(&val, &mut first_ts, &mut last_ts);

        let entry_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if entry_type == "user" {
            if let Some(ts) = val
                .get("timestamp")
                .and_then(|v| v.as_str())
                .and_then(parse_rfc3339_secs)
            {
                prompts.push(ts);
            }
            continue;
        }
        if entry_type != "assistant" {
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
            first: ts,
            last: ts,
            input: 0,
            output: 0,
            cache_creation: 0,
            cache_read: 0,
        });
        entry.first = entry.first.min(ts);
        entry.last = entry.last.max(ts);
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

    prompts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation: u64 = 0;
    let mut cache_read: u64 = 0;
    let mut last_context: u64 = 0;
    let mut last_context_ts = f64::NEG_INFINITY;
    let mut samples: Vec<TpsSample> = Vec::with_capacity(by_message.len());
    for usage in by_message.values() {
        input_tokens += usage.input;
        output_tokens += usage.output;
        cache_creation += usage.cache_creation;
        cache_read += usage.cache_read;
        // 最后一条 assistant 的 prompt 总大小 ≈ 当前上下文占用
        if usage.last >= last_context_ts {
            last_context_ts = usage.last;
            last_context = usage.input + usage.cache_creation + usage.cache_read;
        }
        // 生成起点：这条消息第一行之前最近的那条 user 记录
        let Some(anchor) = prompts
            .iter()
            .rev()
            .find(|p| **p < usage.first)
            .copied()
        else {
            continue; // 会话开头那几条没有前置记录，给不出窗口
        };
        let window = usage.last - anchor;
        if usage.output == 0 || window < TPS_MIN_WINDOW_SECS {
            continue;
        }
        let sample = TpsSample { end: usage.last, tokens: usage.output, window };
        if sample.rate() > TPS_MAX_PLAUSIBLE {
            continue;
        }
        samples.push(sample);
    }
    samples.sort_by(|a, b| a.end.partial_cmp(&b.end).unwrap_or(std::cmp::Ordering::Equal));

    let end = last_ts.unwrap_or(0.0);
    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens: input_tokens + output_tokens + cache_creation + cache_read,
        context_tokens: last_context,
        context_window: 0, // Claude session 不带窗口大小
        tps_current: current_rate(&samples),
        tps_5h: aggregate_rate(&samples, end),
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
    let mut metrics = if is_kimi_session(&content) {
        parse_kimi_metrics(&content)
    } else if is_codex_session(&content) {
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
        Ok(parse_session_metrics_cached(path))
    })
    .await
    .map_err(|e| format!("read_session_metrics join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一行 assistant 记录（同一条消息的多个内容块各占一行，usage 重复给）。
    fn assistant(ts: &str, id: &str, out: u64, block: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","message":{{"id":"{id}","role":"assistant","content":[{{"type":"{block}"}}],"usage":{{"input_tokens":10,"output_tokens":{out},"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}}}}"#
        )
    }

    fn user(ts: &str) -> String {
        format!(r#"{{"type":"user","timestamp":"{ts}","message":{{"role":"user","content":"hi"}}}}"#)
    }

    /// kimi wire 的一行（省掉无关字段）
    fn kimi_line(v: serde_json::Value) -> String {
        v.to_string()
    }

    fn kimi_usage(out: u64, other: u64, cache_read: u64) -> serde_json::Value {
        serde_json::json!({
            "inputOther": other,
            "output": out,
            "inputCacheRead": cache_read,
            "inputCacheCreation": 0
        })
    }

    #[test]
    fn kimi_metrics_read_usage_and_real_ttft() {
        // 两步：每一步的 output + 真实 ttft/流时长都在 step.end 里，不用反推窗口
        let content = [
            "{\"type\":\"metadata\",\"protocol_version\":\"1.5\",\"created_at\":1}".to_string(),
            kimi_line(serde_json::json!({
                "type": "usage.record", "usageScope": "turn",
                "usage": kimi_usage(356, 0, 32013), "time": 1_000_000
            })),
            kimi_line(serde_json::json!({
                "type": "context.append_loop_event",
                "event": {"type": "tool.call", "name": "Bash"}, "time": 1_000_000
            })),
            kimi_line(serde_json::json!({
                "type": "context.append_loop_event",
                "event": {
                    "type": "step.end",
                    "usage": kimi_usage(356, 0, 32013),
                    "llmFirstTokenLatencyMs": 1898,
                    "llmStreamDurationMs": 7986
                },
                "time": 1_010_000
            })),
            // 累计值：算了就重复计，必须跳过
            kimi_line(serde_json::json!({
                "type": "usage.record", "usageScope": "session",
                "usage": kimi_usage(99999, 99999, 99999), "time": 1_010_000
            })),
            kimi_line(serde_json::json!({
                "type": "usage.record", "usageScope": "turn",
                "usage": kimi_usage(159, 645, 30976), "time": 1_020_000
            })),
            kimi_line(serde_json::json!({
                "type": "context.append_loop_event",
                "event": {
                    "type": "step.end",
                    "usage": kimi_usage(159, 645, 30976),
                    "llmFirstTokenLatencyMs": 4944,
                    "llmStreamDurationMs": 3236
                },
                "time": 1_020_000
            })),
        ]
        .join("\n");

        let m = parse_kimi_metrics(&content);
        assert_eq!(m.tool_calls, 1);
        // 两项 usage.record 四项相加，(session 作用域那条不算)
        assert_eq!(m.total_tokens, 32369 + 31780);
        // 上下文 = 最后一步的 prompt（非缓存输入 + 缓存命中）
        assert_eq!(m.context_tokens, 645 + 30976);
        assert_eq!(m.context_window, 0, "kimi 不暴露窗口，前端据此隐藏那一栏");
        // 窗口 = ttft + 流时长：356 / 9.884 ≈ 36.0
        assert!((m.tps_current - 159.0 / 8.18).abs() < 0.1);
        assert!((m.tps_5h - 515.0 / 18.064).abs() < 0.1);
        assert_eq!(m.last_activity_ts, 1_020_000.0 / 1000.0);
        assert_eq!(m.duration_secs, 20.0);
    }

    #[test]
    fn kimi_metrics_without_usage_is_zero() {
        let content = [
            "{\"type\":\"metadata\",\"protocol_version\":\"1.4\",\"created_at\":1}".to_string(),
            kimi_line(serde_json::json!({
                "type": "turn.prompt",
                "input": [{"type": "text", "text": "还没跑完"}],
                "origin": {"kind": "user"},
                "time": 500_000
            })),
        ]
        .join("\n");
        let m = parse_kimi_metrics(&content);
        assert_eq!(m.total_tokens, 0);
        assert_eq!(m.context_tokens, 0);
        assert_eq!(m.tps_5h, 0.0);
        assert_eq!(m.last_activity_ts, 500.0);
    }

    #[test]
    fn claude_tps_uses_turn_window() {
        // 第一轮：提示 00:00:00 → 消息最后一行 00:00:10（200 token / 10 秒 = 20）
        // 第二轮：工具结果 00:00:20 → 消息 00:00:30（400 token / 10 秒 = 40）
        let content = [
            user("2026-01-01T00:00:00.000Z"),
            assistant("2026-01-01T00:00:05.000Z", "msg_a", 200, "thinking"),
            assistant("2026-01-01T00:00:10.000Z", "msg_a", 200, "text"),
            user("2026-01-01T00:00:20.000Z"),
            assistant("2026-01-01T00:00:30.000Z", "msg_b", 400, "tool_use"),
        ]
        .join("\n");
        let m = parse_claude_metrics(&content);
        assert_eq!(m.tps_current, 40.0, "当前 = 最近一条消息的窗口速度");
        assert_eq!(m.tps_5h, 30.0, "5h = Σ600 token / Σ20 秒");
        // 同一消息的多行不能重复计 token
        assert_eq!(m.total_tokens, 20 + 600);
        assert_eq!(m.tool_calls, 1);
    }

    #[test]
    fn claude_tps_drops_unusable_windows() {
        // 010 token 挤在 0.05 秒里、以及 1000 token 只用 1 秒 —— 都是窗口残缺，丢掉
        let content = [
            user("2026-01-01T00:00:00.000Z"),
            assistant("2026-01-01T00:00:00.050Z", "msg_fast", 500, "text"),
            user("2026-01-01T00:01:00.000Z"),
            assistant("2026-01-01T00:01:01.000Z", "msg_impossible", 5000, "text"),
            user("2026-01-01T00:02:00.000Z"),
            assistant("2026-01-01T00:02:12.000Z", "msg_ok", 1200, "text"),
        ]
        .join("\n");
        let m = parse_claude_metrics(&content);
        assert_eq!(m.tps_current, 100.0, "只有最后一条是可用的窗口");
        assert_eq!(m.tps_5h, 100.0, "残缺窗口不进平均");
    }

    #[test]
    fn claude_tps_without_anchor_is_zero() {
        // 会话开头没有前置记录 → 给不出窗口，不能瞎算
        let content = assistant("2026-01-01T00:00:00.000Z", "msg_first", 500, "text");
        let m = parse_claude_metrics(&content);
        assert_eq!(m.tps_current, 0.0);
        assert_eq!(m.tps_5h, 0.0);
        assert_eq!(m.total_tokens, 510);
    }
}
