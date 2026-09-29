use std::path::PathBuf;

mod unix;

pub(crate) struct ShellCommand {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    unix::home_dir()
}

/// Claude Code 给自己与子进程打的一批「会话身份」环境变量。
///
/// 它们必须在两处被摘掉：
/// 1. **登录 shell 环境采样**——采样是在 app 进程里跑 `zsh -lc 'env'`，子进程会继承 app 的
///    环境；app 若碰巧是在某个 Claude Code 会话里被拉起（`open -a` / 直接执行二进制），
///    这些变量就会混进快照，随后被当成「用户导出的配置」注入每个 PTY 子进程。
/// 2. **PTY 启动**——portable-pty 的子进程以 app 自身环境为基底，同样会带上它们。
///
/// 泄漏的后果：claude 认为自己是某个父会话的子进程，`CLAUDE_CODE_CHILD_SESSION` 会关掉
/// transcript 写入（「⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION
/// marker」），于是续跑/恢复出来的会话不再落盘。
/// 只摘「会话身份」类：ANTHROPIC_* / CLAUDE_CODE_MAX_CONTEXT_TOKENS 这类配置项不动。
pub(crate) const SESSION_SCOPED_AGENT_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_PID",
];

pub(crate) fn login_shell_env() -> &'static [(String, String)] {
    unix::login_shell_env()
}

pub(crate) fn login_shell_path() -> &'static str {
    unix::login_shell_path()
}

pub(crate) fn default_shell_command() -> ShellCommand {
    unix::default_shell_command()
}

pub(crate) fn detect_path(binary: &str) -> String {
    unix::detect_path(binary)
}
