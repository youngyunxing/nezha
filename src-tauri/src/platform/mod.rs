use std::path::PathBuf;

mod unix;

pub(crate) struct ShellCommand {
    pub(crate) program: String,
    pub(crate) args: Vec<String>,
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    unix::home_dir()
}

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
