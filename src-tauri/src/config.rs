//! 智能体本地配置文件的读写（Claude 的 `~/.claude/settings.json`、
//! Codex 的 `~/.codex/config.toml`）——应用设置面板里的「智能体配置」用它。
//!
//! 项目级 `.nezha/config.toml` 已随项目设置弹窗一起移除：里面最后几个字段
//! （默认智能体、提示词前缀、提交信息提示词与超时）都没有消费方了。

use std::fs;
use std::path::PathBuf;

use crate::storage::atomic_write;

fn home_dir() -> Result<PathBuf, String> {
    crate::platform::home_dir().ok_or_else(|| "Cannot find home directory".to_string())
}

fn agent_config_path(agent: &str) -> Result<PathBuf, String> {
    let home = home_dir()?;
    match agent {
        "claude" => Ok(home.join(".claude").join("settings.json")),
        "codex" => Ok(home.join(".codex").join("config.toml")),
        _ => Err(format!("Unknown agent: {}", agent)),
    }
}

#[tauri::command]
pub fn get_agent_config_file_path(agent: String) -> Result<String, String> {
    Ok(agent_config_path(&agent)?.to_string_lossy().into_owned())
}

/// Reads the local settings file for the given agent ("claude" or "codex").
/// Returns None if the file doesn't exist.
#[tauri::command]
pub fn read_agent_config_file(agent: String) -> Result<Option<String>, String> {
    let path = agent_config_path(&agent)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// Writes raw content back to the agent's local settings file.
#[tauri::command]
pub fn write_agent_config_file(agent: String, content: String) -> Result<(), String> {
    let path = agent_config_path(&agent)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(&path, &content)
}
