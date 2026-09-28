export type SendShortcut = "mod_enter" | "enter";

export const DEFAULT_SEND_SHORTCUT: SendShortcut = "mod_enter";

export interface PromptKeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  /** Optional: real KeyboardEvents always carry it; kept optional so plain test literals stay valid. */
  altKey?: boolean;
}

export function normalizeSendShortcut(value: unknown): SendShortcut {
  return value === "enter" || value === "mod_enter" ? value : DEFAULT_SEND_SHORTCUT;
}

export function getSendShortcutLabel(shortcut: SendShortcut): string {
  return getSendShortcutKeys(shortcut).join("");
}

export function getNewlineShortcutLabel(shortcut: SendShortcut): string {
  return getNewlineShortcutKeys(shortcut).join("");
}

export function getSendShortcutKeys(shortcut: SendShortcut): string[] {
  if (shortcut === "enter") {
    return ["↵"];
  }
  return ["⌘", "↵"];
}

export function getNewlineShortcutKeys(shortcut: SendShortcut): string[] {
  if (shortcut === "enter") {
    return ["⌘", "↵"];
  }
  return ["↵"];
}

/**
 * Cmd+W —— 收起窗口（隐藏到 Dock）。
 * 在全局 keydown 捕获阶段匹配，绕过 webview 默认的关闭行为。
 */
export function isHideWindowShortcut(event: PromptKeyEventLike): boolean {
  if (event.key !== "w" && event.key !== "W") {
    return false;
  }
  if (event.shiftKey) {
    return false;
  }
  return event.metaKey && !event.ctrlKey;
}

/**
 * Cmd+K —— 切换看板浮层（开/关）。用 ⌘ 而非 Ctrl：Ctrl+K 是 readline 的
 * kill-line，且 Ctrl+Shift+C/V 是终端复制粘贴命名空间。在全局 keydown 捕获阶段
 * 匹配，先于 xterm 处理。展示键位见 getKanbanShortcutKeys。
 */
export function isToggleKanbanShortcut(event: PromptKeyEventLike): boolean {
  if (event.key !== "k" && event.key !== "K") {
    return false;
  }
  if (event.shiftKey) {
    return false;
  }
  return event.metaKey && !event.ctrlKey && !event.altKey;
}

/**
 * 看板切换快捷键的展示键位。与 isToggleKanbanShortcut 共用同一套定义，
 * 保证提示与实际触发一致。
 */
export function getKanbanShortcutKeys(): string[] {
  return ["⌘", "K"];
}

/** 纯文本标签（用于 HTML title 等场景）。 */
export function getKanbanShortcutLabel(): string {
  return getKanbanShortcutKeys().join("");
}

export function shouldInsertPromptNewlineKey(
  event: PromptKeyEventLike,
  shortcut: SendShortcut,
): boolean {
  if (event.key !== "Enter") {
    return false;
  }
  if (shortcut !== "enter" || event.shiftKey) {
    return false;
  }
  return event.metaKey && !event.ctrlKey;
}

export function shouldSubmitPromptKey(
  event: PromptKeyEventLike,
  shortcut: SendShortcut,
): boolean {
  if (event.key !== "Enter") {
    return false;
  }

  if (shortcut === "enter") {
    return !event.shiftKey && !event.metaKey && !event.ctrlKey;
  }

  if (event.shiftKey) {
    return false;
  }

  return event.metaKey;
}

// ---------------------------------------------------------------------------
// Terminal "insert newline" shortcut
//
// Inside the embedded xterm, plain Enter is always forwarded to the agent
// (Claude Code / Codex) as a submit. A second combo lets the user insert a
// newline without submitting.
//
// Option/Alt + Enter is ALWAYS treated as "insert newline" — it is the
// universal combo agents already understand, so there is nothing to configure.
// Shift + Enter is the only configurable part: a single on/off toggle (default
// on) for users who prefer that ergonomics.
// ---------------------------------------------------------------------------

export const DEFAULT_SHIFT_ENTER_NEWLINE = true;

/**
 * Esc + CR. Both Claude Code and Codex interpret this as "insert newline" — it
 * is exactly the byte sequence Option/Alt + Enter emits in the JetBrains
 * terminal fallback. We emit it ourselves so the embedded xterm (which does not
 * negotiate the kitty / CSI-u keyboard protocol with the agent) behaves
 * consistently across platforms. Sending raw "\n" instead is avoided on
 * purpose: it can disrupt programs that rely on the kitty protocol.
 */
export const TERMINAL_NEWLINE_SEQUENCE = "\x1b\r";

export interface TerminalKeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True while an IME composition is in progress (real KeyboardEvent field). */
  isComposing?: boolean;
  /** 229 while an IME composition is in progress (legacy field, kept for Safari). */
  keyCode?: number;
}

export function normalizeShiftEnterNewline(value: unknown): boolean {
  return typeof value === "boolean" ? value : DEFAULT_SHIFT_ENTER_NEWLINE;
}

export function getAltEnterNewlineKeys(): string[] {
  return ["⌥", "↵"];
}

export function getShiftEnterNewlineKeys(): string[] {
  return ["⇧", "↵"];
}

/**
 * Whether a terminal key event should insert a newline instead of submitting.
 * Option/Alt + Enter always qualifies; Shift + Enter only when the user has the
 * toggle enabled. Enter on its own (and Cmd/Ctrl + Enter) is never matched — it
 * stays a submit.
 */
export function matchesTerminalNewline(
  event: TerminalKeyEventLike,
  shiftEnterEnabled: boolean,
): boolean {
  // Never hijack a key that is committing an IME composition (e.g. a CJK user
  // pressing Shift+Enter to accept a candidate) — that must reach the IME, not
  // become a newline.
  if (event.isComposing || event.keyCode === 229) {
    return false;
  }
  if (event.key !== "Enter" || event.metaKey || event.ctrlKey) {
    return false;
  }
  // Alt+Enter: always a newline. Shift+Enter: only when enabled.
  if (event.altKey && !event.shiftKey) {
    return true;
  }
  return shiftEnterEnabled && event.shiftKey && !event.altKey;
}
