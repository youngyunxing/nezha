use std::fs;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

use super::ShellCommand;

static LOGIN_SHELL_ENV: OnceLock<Vec<(String, String)>> = OnceLock::new();
static LOGIN_SHELL_PATH: OnceLock<String> = OnceLock::new();
const ENV_SENTINEL: &[u8] = b"__NEZHA_ENV_START__\0";

pub(crate) fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

pub(crate) fn login_shell_env() -> &'static [(String, String)] {
    LOGIN_SHELL_ENV
        .get_or_init(|| drop_session_scoped_agent_env(resolve_login_shell_env()))
        .as_slice()
}

/// 采样结果里剔除「会话身份」变量（见 `SESSION_SCOPED_AGENT_ENV`）。
/// 采样命令是 app 的子进程，会把 app 自身环境一并带出来，所以必须在出口处过滤，
/// 否则这些变量会被当成用户配置注入每个 PTY。
fn drop_session_scoped_agent_env(env: Vec<(String, String)>) -> Vec<(String, String)> {
    env.into_iter()
        .filter(|(key, _)| !super::SESSION_SCOPED_AGENT_ENV.contains(&key.as_str()))
        .collect()
}

pub(crate) fn login_shell_path() -> &'static str {
    LOGIN_SHELL_PATH.get_or_init(|| {
        login_shell_env()
            .iter()
            .find(|(key, _)| key == "PATH")
            .map(|(_, value)| value.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(build_fallback_path)
    })
}

pub(crate) fn default_shell_command() -> ShellCommand {
    ShellCommand {
        program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
        args: Vec::new(),
    }
}

/// ChatGPT 桌面版把 codex 装在自己的 bundle 里，具体相对路径随版本变过
/// （见过 `Contents/Resources/codex-cli/bin/codex`，也有 `.../CodexCLI.app/Contents/MacOS/codex`），
/// 所以先试已知路径，再在 `Contents/Resources/*/bin/codex` 浅扫一层。
fn chatgpt_bundled_codex() -> Option<String> {
    const KNOWN: &[&str] = &[
        "codex-cli/bin/codex",
        "codex-cli/CodexCLI.app/Contents/MacOS/codex",
    ];
    let mut apps = vec![std::path::PathBuf::from("/Applications/ChatGPT.app")];
    if let Some(home) = crate::platform::home_dir() {
        apps.push(home.join("Applications").join("ChatGPT.app"));
    }

    for app in apps {
        let resources = app.join("Contents").join("Resources");
        for rel in KNOWN {
            let candidate = resources.join(rel);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        let Ok(entries) = fs::read_dir(&resources) else {
            continue;
        };
        for entry in entries.flatten() {
            let candidate = entry.path().join("bin").join("codex");
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn bundled_binary_path(binary: &str) -> Option<String> {
    // 随 App 装的（ChatGPT 自带 codex）
    if binary == "codex" {
        return chatgpt_bundled_codex();
    }
    // 自己装了但未必在 GUI PATH 上：kimi 官方安装器落在 ~/.kimi-code/bin
    if binary == "kimi" {
        let home = crate::platform::home_dir()?;
        for rel in [".kimi-code/bin/kimi", ".kimi/bin/kimi", ".local/bin/kimi"] {
            let candidate = home.join(rel);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

pub(crate) fn detect_path(binary: &str) -> String {
    let output = Command::new("which")
        .arg(binary)
        .env("PATH", login_shell_path())
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() {
                return path;
            }
        }
    }

    // PATH 上没有：看看是不是随 App 装的
    bundled_binary_path(binary).unwrap_or_default()
}

fn resolve_login_shell_env() -> Vec<(String, String)> {
    let shell = default_shell_command().program;

    if let Some(env) = read_shell_env(&shell, true) {
        return env;
    }

    if let Some(env) = read_shell_env(&shell, false) {
        return env;
    }

    build_fallback_env()
}

fn read_shell_env(shell: &str, interactive: bool) -> Option<Vec<(String, String)>> {
    let args: &[&str] = if interactive {
        &["-l", "-i", "-c", "printf '__NEZHA_ENV_START__\\0'; env -0"]
    } else {
        &["-l", "-c", "printf '__NEZHA_ENV_START__\\0'; env -0"]
    };

    let output = Command::new(shell)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    parse_shell_env_output(&output.stdout)
}

fn parse_shell_env_output(stdout: &[u8]) -> Option<Vec<(String, String)>> {
    let start = stdout
        .windows(ENV_SENTINEL.len())
        .position(|window| window == ENV_SENTINEL)?
        + ENV_SENTINEL.len();

    let mut env = Vec::new();
    for entry in stdout[start..].split(|byte| *byte == 0) {
        if entry.is_empty() {
            continue;
        }

        let Some(eq) = entry.iter().position(|byte| *byte == b'=') else {
            continue;
        };
        let key = String::from_utf8_lossy(&entry[..eq]).into_owned();
        if key.is_empty() || matches!(key.as_str(), "PWD" | "OLDPWD" | "SHLVL" | "_") {
            continue;
        }
        let value = String::from_utf8_lossy(&entry[eq + 1..]).into_owned();
        env.push((key, value));
    }

    if env.is_empty() {
        None
    } else {
        Some(env)
    }
}

fn build_fallback_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let extras = [
        format!("{home}/.local/bin"),
        format!("{home}/.npm-global/bin"),
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    let mut parts: Vec<String> = extras.to_vec();
    for path in current.split(':') {
        if !path.is_empty() && !parts.iter().any(|part| part == path) {
            parts.push(path.to_string());
        }
    }
    parts.join(":")
}

fn build_fallback_env() -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(key, _)| !matches!(key.as_str(), "PWD" | "OLDPWD" | "SHLVL" | "_"))
        .collect();

    if let Some((_, path)) = env.iter_mut().find(|(key, _)| key == "PATH") {
        *path = build_fallback_path();
    } else {
        env.push(("PATH".to_string(), build_fallback_path()));
    }

    if !env.iter().any(|(key, _)| key == "HOME") {
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            env.push(("HOME".to_string(), home));
        }
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_session_scoped_vars_but_keeps_user_config() {
        let env = vec![
            ("CLAUDE_CODE_CHILD_SESSION".to_string(), "1".to_string()),
            ("CLAUDECODE".to_string(), "1".to_string()),
            ("CLAUDE_PID".to_string(), "55174".to_string()),
            ("ANTHROPIC_BASE_URL".to_string(), "http://127.0.0.1:15721".to_string()),
            ("PATH".to_string(), "/usr/bin:/bin".to_string()),
        ];

        assert_eq!(
            drop_session_scoped_agent_env(env),
            vec![
                ("ANTHROPIC_BASE_URL".to_string(), "http://127.0.0.1:15721".to_string()),
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
            ]
        );
    }
}
