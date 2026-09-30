use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

// ── Data types (mirror TypeScript interfaces) ────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: Option<String>,
    #[serde(rename = "lastOpenedAt")]
    pub last_opened_at: i64,
    // 缺省=常驻；旧数据无此字段时默认 false，序列化时省略 false 以保持文件简洁。
    #[serde(
        rename = "hiddenFromRail",
        default,
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub hidden_from_rail: bool,
    // 用户自定义头像外观；与前端 types.ts 的 ProjectAvatarStyle 同步。
    // 缺省 None，序列化时省略，旧数据无需迁移。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<ProjectAvatar>,
}

/// 项目头像自定义项（颜色 key / emoji / 缩写），三项全部可选。
/// color 存色板 key（如 "red"）而非 hex，具体颜色值由前端主题决定。
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ProjectAvatar {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// 自定义图片（data URL）。**字段必须与前端 ProjectAvatarStyle 同步** —— 少写一个
    /// 就是「存得下读不回」（kimiSessionId 那样翻车过一次）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

/// 任务落盘用的 DTO。**字段必须与前端 `src/types.ts` 的 `Task` 一一对应** ——
/// 前端把整个任务对象发过来，serde 默认丢弃认不出的字段，这里少写一个字段就等于
/// 「存得下、读不回」，而且不报错（kimiSessionId 就这么丢过一次）。
/// 对齐检查见本文件 tests::dto_fields_match_frontend_task（会直接比对 `src/types.ts`）。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Task {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub prompt: String,
    pub agent: String,
    #[serde(rename = "permissionMode")]
    pub permission_mode: String,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(rename = "attentionRequestedAt", skip_serializing_if = "Option::is_none")]
    pub attention_requested_at: Option<i64>,
    #[serde(rename = "claudeSessionId", skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    #[serde(rename = "claudeSessionPath", skip_serializing_if = "Option::is_none")]
    pub claude_session_path: Option<String>,
    #[serde(rename = "codexSessionId", skip_serializing_if = "Option::is_none")]
    pub codex_session_id: Option<String>,
    #[serde(rename = "codexSessionPath", skip_serializing_if = "Option::is_none")]
    pub codex_session_path: Option<String>,
    #[serde(rename = "kimiSessionId", skip_serializing_if = "Option::is_none")]
    pub kimi_session_id: Option<String>,
    #[serde(rename = "kimiSessionPath", skip_serializing_if = "Option::is_none")]
    pub kimi_session_path: Option<String>,
    /// 纯终端任务要跑的命令（快捷按钮带来）。不落盘的话，重启后「重新开始」会退化成
    /// 一个空 shell。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// fork 出来的任务记着源会话 id：自己的 transcript 是空的时要靠它再 fork 一次。
    #[serde(rename = "forkedFromSessionId", skip_serializing_if = "Option::is_none")]
    pub forked_from_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(rename = "failureReason", skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(rename = "worktreePath", skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(rename = "worktreeBranch", skip_serializing_if = "Option::is_none")]
    pub worktree_branch: Option<String>,
    #[serde(rename = "worktreeRepo", skip_serializing_if = "Option::is_none")]
    pub worktree_repo: Option<String>,
    #[serde(rename = "baseBranch", skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(rename = "worktreeDiscarded", skip_serializing_if = "Option::is_none")]
    pub worktree_discarded: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<i32>,
}

// ── Path helpers ─────────────────────────────────────────────────────────────

pub(crate) fn nezha_dir() -> Result<PathBuf, String> {
    let home = crate::platform::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".nezha"))
}

fn projects_path() -> Result<PathBuf, String> {
    Ok(nezha_dir()?.join("projects.json"))
}

fn tasks_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("tasks.json"))
}

fn project_dir(project_id: &str) -> Result<PathBuf, String> {
    Ok(nezha_dir()?.join("projects").join(project_id))
}

pub(crate) fn ensure_nezha_dirs() -> Result<(), String> {
    fs::create_dir_all(nezha_dir()?).map_err(|e| e.to_string())
}

fn ensure_project_dir(project_id: &str) -> Result<(), String> {
    fs::create_dir_all(project_dir(project_id)?).map_err(|e| e.to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_projects() -> Result<Vec<Project>, String> {
    let path = projects_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_projects(projects: Vec<Project>) -> Result<(), String> {
    ensure_nezha_dirs()?;
    let raw = serde_json::to_string_pretty(&projects).map_err(|e| e.to_string())?;
    atomic_write(&projects_path()?, &raw)
}

#[tauri::command]
pub fn load_project_tasks(project_id: String) -> Result<Vec<Task>, String> {
    let path = tasks_path(&project_id)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|parse_err| {
        // 系统崩溃(掉电/蓝屏)可能留下空或截断的 tasks.json。把损坏文件挪走
        // 保留人工恢复现场,下次启动即回到正常空列表,不会永久卡死在解析报错上。
        let secs = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup = path.with_file_name(format!("tasks.json.corrupt-{secs}"));
        match fs::rename(&path, &backup) {
            Ok(()) => format!(
                "tasks.json is corrupted ({parse_err}); moved to {} for manual recovery",
                backup.display()
            ),
            Err(mv_err) => {
                format!("tasks.json is corrupted ({parse_err}); failed to move it aside: {mv_err}")
            }
        }
    })
}

/// 终端屏幕快照落盘位置。任务记录按 project_id 存放，屏幕也跟着走同一目录，
/// 删项目时一起留着（和会话记录一个待遇）。
fn task_screen_path(project_id: &str, task_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("screens").join(format!("{task_id}.txt")))
}

/// 保存某任务的终端屏幕（xterm 序列化结果）。空内容视为删除。
#[tauri::command]
pub fn save_task_screen(
    project_id: String,
    task_id: String,
    content: String,
) -> Result<(), String> {
    let path = task_screen_path(&project_id, &task_id)?;
    if content.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(&path, &content)
}

/// 读回某任务的终端屏幕；没有则 None。
#[tauri::command]
pub fn load_task_screen(project_id: String, task_id: String) -> Result<Option<String>, String> {
    let path = task_screen_path(&project_id, &task_id)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// 任务被删除时清掉它的屏幕快照。
#[tauri::command]
pub fn delete_task_screen(project_id: String, task_id: String) -> Result<(), String> {
    let path = task_screen_path(&project_id, &task_id)?;
    let _ = fs::remove_file(&path);
    Ok(())
}

/// 项目目录里记一份原始路径。任务记录按 project_id 存放，而 id 是「添加项目」
/// 那一刻生成的；把路径落盘后，「删掉项目再用同一目录重新添加」才能找回旧记录。
#[derive(Serialize, Deserialize)]
struct ProjectMeta {
    path: String,
}

fn project_meta_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project_id)?.join("meta.json"))
}

#[tauri::command]
pub fn save_project_meta(project_id: String, path: String) -> Result<(), String> {
    ensure_project_dir(&project_id)?;
    let raw = serde_json::to_string_pretty(&ProjectMeta { path }).map_err(|e| e.to_string())?;
    atomic_write(&project_meta_path(&project_id)?, &raw)
}

/// 按绝对路径找已有记录的项目 id（没有则 None）。删除项目时任务记录会保留，
/// 这里就是「重新添加同一目录」时找回它们的唯一线索。
#[tauri::command]
pub fn find_project_id_by_path(path: String) -> Result<Option<String>, String> {
    let dir = nezha_dir()?.join("projects");
    if !dir.exists() {
        return Ok(None);
    }
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        // 单条记录损坏（截断的 meta.json）不该让查找整体失败，跳过即可。
        let Ok(raw) = fs::read_to_string(entry.path().join("meta.json")) else {
            continue;
        };
        if let Ok(meta) = serde_json::from_str::<ProjectMeta>(&raw) {
            if meta.path == path {
                return Ok(Some(entry.file_name().to_string_lossy().into_owned()));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn save_project_tasks(project_id: String, tasks: Vec<Task>) -> Result<(), String> {
    ensure_project_dir(&project_id)?;
    // 空列表也照常写 "[]",不删文件:删除路径曾放大过崩溃后的数据丢失
    // (加载失败 → 前端空 state → 空列表保存把磁盘上仅存的原始文件删掉)。
    let raw = serde_json::to_string_pretty(&tasks).map_err(|e| e.to_string())?;
    atomic_write(&tasks_path(&project_id)?, &raw)
}

// ── Atomic write (write to tmp then rename) ───────────────────────────────────

/// 原子写入：先写入唯一临时文件，fsync 落盘后再 rename 到目标路径。
/// 临时文件名包含 pid + 纳秒时间戳，避免并发写入时临时文件相互覆盖。
///
/// rename 只保证元数据原子性,不保证数据先于 rename 落盘——NTFS/APFS 都只
/// journal 元数据,掉电/系统崩溃时会留下 0 字节或截断的目标文件(Windows 用户
/// 实际踩过:突然重启后 tasks.json 清空)。rename 前必须 sync_all
/// (Windows=FlushFileBuffers,macOS=F_FULLFSYNC)强制数据先持久化。
pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    let write_and_sync = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    };
    if let Err(e) = write_and_sync() {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::Task;

    /// 从 `export interface Task { ... }` 里抠出字段名（够用的行级解析，不引正则）。
    fn frontend_task_fields(source: &str) -> Vec<String> {
        let start = source
            .find("export interface Task {")
            .expect("src/types.ts 里找不到 `export interface Task`");
        let rest = &source[start..];
        let end = rest.find("\n}").expect("Task 接口没有闭合");
        rest[..end]
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                let name: String = line
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                if name.is_empty() {
                    return None;
                }
                let after = line[name.len()..].trim_start();
                let after = after.strip_prefix('?').unwrap_or(after).trim_start();
                after.starts_with(':').then_some(name)
            })
            .collect()
    }

    /// 从 `pub struct Task { ... }` 里抠出**发给前端的 JSON key**（serde rename 优先）。
    fn rust_task_fields(source: &str) -> Vec<String> {
        let start = source.find("pub struct Task {").expect("找不到 `pub struct Task`");
        let rest = &source[start..];
        let end = rest.find("\n}").expect("Task 结构体没有闭合");
        let mut fields = Vec::new();
        let mut renamed: Option<String> = None;
        for line in rest[..end].lines() {
            let line = line.trim();
            if let Some(pos) = line.find("rename = \"") {
                let tail = &line[pos + 10..];
                if let Some(quote) = tail.find('"') {
                    renamed = Some(tail[..quote].to_string());
                }
                continue;
            }
            if let Some(stripped) = line.strip_prefix("pub ") {
                if let Some(colon) = stripped.find(':') {
                    fields.push(renamed.take().unwrap_or_else(|| stripped[..colon].to_string()));
                }
            }
        }
        fields
    }

    /// 前端把整个任务对象发给 save_project_tasks，serde 对认不出的字段**静默丢弃** ——
    /// DTO 少写一个字段就是「存得下、读不回」，而且一声不响。kimiSessionId / kimiSessionPath
    /// 就这么整对丢过：表现是重启后 kimi 任务没有会话 id，回放和恢复都用不了。
    #[test]
    fn dto_fields_match_frontend_task() {
        // 前端类型在仓库根的 src/，本文件在 src-tauri/src/
        let frontend_src = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/types.ts");
        let types = std::fs::read_to_string(frontend_src).unwrap();
        let storage = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/storage.rs")).unwrap();

        let mut frontend = frontend_task_fields(&types);
        // 启动加载任务时由后端重新算的字段（见 App.tsx 里拿子进程表算 processAlive），故意不落盘
        frontend.retain(|field| field != "processAlive");
        frontend.sort();

        let mut dto = rust_task_fields(&storage);
        dto.sort();

        assert_eq!(dto, frontend, "storage::Task 的字段必须与 types.ts 的 Task 一一对应");
    }

    #[test]
    fn dto_keeps_all_three_agents_sessions() {
        let storage = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/storage.rs")).unwrap();
        let fields = rust_task_fields(&storage);
        for field in [
            "claudeSessionId",
            "claudeSessionPath",
            "codexSessionId",
            "codexSessionPath",
            "kimiSessionId",
            "kimiSessionPath",
        ] {
            assert!(fields.contains(&field.to_string()), "落盘 DTO 少了 {}", field);
        }
    }

    /// 前端发来的任务对象 → 落盘 → 读回，字段一个都不能少。
    /// （serde 会**静默丢弃**认不出的字段，少写一个字段就是「存得下、读不回」。）
    #[test]
    fn task_round_trip_keeps_every_session_field() {
        let raw = r#"{
            "id": "1", "projectId": "p", "prompt": "",
            "agent": "kimi", "permissionMode": "full_access", "status": "idle",
            "createdAt": 1, "updatedAt": 2, "attentionRequestedAt": 3,
            "claudeSessionId": "c", "claudeSessionPath": "/c.jsonl",
            "codexSessionId": "x", "codexSessionPath": "/x.jsonl",
            "kimiSessionId": "session_k", "kimiSessionPath": "/k/agents/main/wire.jsonl",
            "command": "pnpm test", "forkedFromSessionId": "src-session",
            "worktreePath": "/wt", "worktreeBranch": "b", "worktreeRepo": "/repo",
            "baseBranch": "dev", "worktreeDiscarded": true,
            "starred": true, "failureReason": "boom", "additions": 1, "deletions": 2
        }"#;

        let task: Task = serde_json::from_str(raw).unwrap();
        let back: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&task).unwrap()).unwrap();
        let original: serde_json::Value = serde_json::from_str(raw).unwrap();

        assert_eq!(back, original, "落盘一趟回来字段必须完全一致");
    }
}
