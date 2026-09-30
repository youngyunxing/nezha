use std::path::Path;
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

/// 随桌面 App 一起装的 CLI：不在 PATH 上，但可以直接执行。
/// ChatGPT 桌面版自带 codex（实测 /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
/// 能跑出 `codex-cli 0.159.0`），而用户往往以为"装了 ChatGPT 就等于装了 codex"。
const APP_BUNDLED_BINARIES: &[(&str, &[&str])] = &[(
    "codex",
    &[
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
    ],
)];

fn bundled_binary_path(binary: &str) -> Option<String> {
    let (_, candidates) = APP_BUNDLED_BINARIES.iter().find(|(name, _)| *name == binary)?;
    let home_apps = crate::platform::home_dir().map(|home| home.join("Applications"));
    for candidate in *candidates {
        if Path::new(candidate).is_file() {
            return Some((*candidate).to_string());
        }
    }
    // ~/Applications 下也装一份的情况
    if let Some(apps) = home_apps {
        let tail = candidates[0].trim_start_matches("/Applications/");
        let p = apps.join(tail);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
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
